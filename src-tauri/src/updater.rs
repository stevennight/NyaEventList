use reqwest::header::{HeaderValue, ACCEPT};
use semver::Version;
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const GITHUB_API_ACCEPT: &str = "application/vnd.github+json";
const MAX_RELEASE_METADATA_BYTES: u64 = 2 * 1024 * 1024;
const MAX_CHECKSUM_BYTES: u64 = 1024 * 1024;
const MAX_INSTALLER_BYTES: u64 = 256 * 1024 * 1024;
const PRODUCT_NAME: &str = "NyaEventList";

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UpdateSupportReason {
    DevelopmentBuild,
    NotInstalled,
    #[allow(dead_code)]
    UnsupportedPlatform,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum WindowsInstallerKind {
    Msi,
    Nsis,
}

#[derive(Debug, PartialEq, Eq, serde::Serialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum UpdateCheckResult {
    Unsupported {
        current_version: String,
        reason: UpdateSupportReason,
    },
    UpToDate {
        current_version: String,
    },
    Available {
        current_version: String,
        version: String,
        release_name: String,
        release_notes: String,
        published_at: String,
    },
}

#[derive(Clone, Debug, serde::Deserialize)]
struct GitHubReleaseAsset {
    name: String,
    browser_download_url: String,
    size: u64,
}

#[derive(Clone, Debug, serde::Deserialize)]
struct GitHubRelease {
    tag_name: String,
    name: Option<String>,
    body: Option<String>,
    published_at: Option<String>,
    draft: bool,
    prerelease: bool,
    assets: Vec<GitHubReleaseAsset>,
}

pub async fn check_for_updates(
    current_version: &str,
    repository: &str,
) -> Result<UpdateCheckResult, String> {
    if let Some(reason) = update_support_reason(current_version) {
        return Ok(UpdateCheckResult::Unsupported {
            current_version: current_version.to_string(),
            reason,
        });
    }

    let release = fetch_latest_release(repository, false).await?;
    classify_update(current_version, &release)
}

fn classify_update(
    current_version: &str,
    release: &GitHubRelease,
) -> Result<UpdateCheckResult, String> {
    let current = parse_stable_version(current_version, "current application version")?;
    let latest = release_version(release)?;

    if latest <= current {
        return Ok(UpdateCheckResult::UpToDate {
            current_version: current_version.to_string(),
        });
    }

    let version = latest.to_string();
    Ok(UpdateCheckResult::Available {
        current_version: current_version.to_string(),
        release_name: release
            .name
            .as_deref()
            .filter(|name| !name.trim().is_empty())
            .unwrap_or(&release.tag_name)
            .trim()
            .to_string(),
        release_notes: truncate_text(release.body.as_deref().unwrap_or_default().trim(), 4_000),
        published_at: release.published_at.clone().unwrap_or_default(),
        version,
    })
}

pub async fn download_and_install_update(
    app: &AppHandle,
    current_version: &str,
    repository: &str,
    requested_version: &str,
) -> Result<(), String> {
    if let Some(reason) = update_support_reason(current_version) {
        return Err(match reason {
            UpdateSupportReason::DevelopmentBuild => {
                "Automatic updates are unavailable in development builds."
            }
            UpdateSupportReason::NotInstalled => {
                "Automatic updates are unavailable for portable copies."
            }
            UpdateSupportReason::UnsupportedPlatform => {
                "Automatic updates are unavailable on this platform."
            }
        }
        .to_string());
    }

    let current = parse_stable_version(current_version, "current application version")?;
    let requested = parse_stable_version(requested_version, "requested update version")?;
    if requested <= current {
        return Err("The requested update is not newer than the installed version.".to_string());
    }

    let release = fetch_latest_release(repository, true).await?;
    let latest = release_version(&release)?;
    if latest != requested {
        return Err("The selected update is no longer the latest GitHub release. Check again before installing.".to_string());
    }

    let (installer_asset, checksum_asset) = validate_release_assets(repository, &release)?;
    let checksum_bytes = download_bytes(
        &checksum_asset.browser_download_url,
        MAX_CHECKSUM_BYTES,
        "release checksums",
    )
    .await?;
    let checksum_text = std::str::from_utf8(&checksum_bytes)
        .map_err(|_| "The GitHub release checksum file is not valid UTF-8.".to_string())?;
    let expected_checksum =
        checksum_for_file(checksum_text, &installer_asset.name).ok_or_else(|| {
            format!(
                "The GitHub release does not contain a checksum for {}.",
                installer_asset.name
            )
        })?;

    let update_directory = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("Could not locate the application cache folder: {error}"))?
        .join("updates")
        .join(latest.to_string());
    fs::create_dir_all(&update_directory)
        .map_err(|error| format!("Could not prepare the update download folder: {error}"))?;

    let installer_path = download_installer(
        installer_asset,
        &expected_checksum,
        &update_directory,
        &latest,
    )
    .await?;
    launch_installer(&installer_path)?;
    app.exit(0);
    Ok(())
}

fn update_support_reason(current_version: &str) -> Option<UpdateSupportReason> {
    if cfg!(debug_assertions) {
        return Some(UpdateSupportReason::DevelopmentBuild);
    }

    let Ok(version) = Version::parse(current_version) else {
        return Some(UpdateSupportReason::DevelopmentBuild);
    };
    if !version.pre.is_empty() || !version.build.is_empty() {
        return Some(UpdateSupportReason::DevelopmentBuild);
    }

    #[cfg(windows)]
    {
        if current_windows_installer_kind().is_none() {
            return Some(UpdateSupportReason::NotInstalled);
        }
        None
    }

    #[cfg(not(windows))]
    {
        Some(UpdateSupportReason::UnsupportedPlatform)
    }
}

fn parse_stable_version(value: &str, label: &str) -> Result<Version, String> {
    let version =
        Version::parse(value).map_err(|error| format!("The {label} is invalid: {error}"))?;
    if !version.pre.is_empty() || !version.build.is_empty() {
        return Err(format!("The {label} is not a stable semantic version."));
    }
    Ok(version)
}

async fn fetch_latest_release(
    repository: &str,
    resolve_fallback_assets: bool,
) -> Result<GitHubRelease, String> {
    match fetch_latest_release_metadata(repository).await {
        Ok(release) => Ok(release),
        Err(api_error) => {
            let mut release = fetch_latest_release_from_web(repository)
                .await
                .map_err(|web_error| {
                    format!(
                        "Could not determine the latest GitHub release. API attempt: {api_error} Release page attempt: {web_error}"
                    )
                })?;
            if resolve_fallback_assets {
                release.assets = fetch_release_assets_from_checksum(repository, &release.tag_name)
                    .await
                    .map_err(|asset_error| {
                        format!(
                            "GitHub release metadata was unavailable through the API and its assets could not be resolved from SHA256SUMS: {asset_error}"
                        )
                    })?;
            }
            Ok(release)
        }
    }
}

async fn fetch_latest_release_metadata(repository: &str) -> Result<GitHubRelease, String> {
    validate_repository(repository)?;
    let url = format!("https://api.github.com/repos/{repository}/releases/latest");
    let response = successful_get(
        &url,
        GITHUB_API_ACCEPT,
        "fetch GitHub release metadata",
        true,
        Duration::from_secs(12),
    )
    .await?;
    let bytes = response_bytes(
        response,
        MAX_RELEASE_METADATA_BYTES,
        "GitHub release metadata",
    )
    .await?;
    let release: GitHubRelease = serde_json::from_slice(&bytes)
        .map_err(|error| format!("GitHub returned invalid release metadata: {error}"))?;
    if release.draft || release.prerelease {
        return Err(
            "GitHub returned a draft or prerelease as the latest stable release.".to_string(),
        );
    }
    Ok(release)
}

async fn fetch_release_assets_from_checksum(
    repository: &str,
    tag_name: &str,
) -> Result<Vec<GitHubReleaseAsset>, String> {
    let checksum_url =
        format!("https://github.com/{repository}/releases/download/{tag_name}/SHA256SUMS");
    let checksum_bytes =
        download_bytes(&checksum_url, MAX_CHECKSUM_BYTES, "release checksums").await?;
    let checksum_text = std::str::from_utf8(&checksum_bytes)
        .map_err(|_| "The GitHub release checksum file is not valid UTF-8.".to_string())?;
    let mut assets = checksum_file_names(checksum_text)
        .into_iter()
        .map(|name| GitHubReleaseAsset {
            browser_download_url: format!(
                "https://github.com/{repository}/releases/download/{tag_name}/{name}"
            ),
            name,
            size: 0,
        })
        .collect::<Vec<_>>();
    if assets.is_empty() {
        return Err("The GitHub release checksum file contains no valid assets.".to_string());
    }
    assets.push(GitHubReleaseAsset {
        name: "SHA256SUMS".to_string(),
        browser_download_url: checksum_url,
        size: checksum_bytes.len() as u64,
    });
    Ok(assets)
}

async fn fetch_latest_release_from_web(repository: &str) -> Result<GitHubRelease, String> {
    validate_repository(repository)?;
    let url = format!("https://github.com/{repository}/releases/latest");
    let response = successful_get(
        &url,
        "text/html",
        "follow the GitHub latest-release page",
        false,
        Duration::from_secs(12),
    )
    .await?;
    release_from_web_url(repository, response.url().as_str())
}

fn release_from_web_url(repository: &str, url: &str) -> Result<GitHubRelease, String> {
    let url = reqwest::Url::parse(url)
        .map_err(|error| format!("GitHub returned an invalid release page URL: {error}"))?;
    if url.scheme() != "https" || url.host_str() != Some("github.com") {
        return Err("GitHub redirected the release page to an untrusted address.".to_string());
    }

    let repository_parts = repository.split('/').collect::<Vec<_>>();
    let path_parts = url
        .path_segments()
        .map(|segments| segments.collect::<Vec<_>>())
        .unwrap_or_default();
    if repository_parts.len() != 2
        || path_parts.len() != 5
        || !path_parts[0].eq_ignore_ascii_case(repository_parts[0])
        || !path_parts[1].eq_ignore_ascii_case(repository_parts[1])
        || path_parts[2] != "releases"
        || path_parts[3] != "tag"
    {
        return Err("GitHub returned an unexpected latest-release page.".to_string());
    }

    let tag_name = path_parts[4].to_string();
    let release = GitHubRelease {
        name: Some(tag_name.clone()),
        tag_name,
        body: None,
        published_at: None,
        draft: false,
        prerelease: false,
        assets: Vec::new(),
    };
    release_version(&release)?;
    Ok(release)
}

fn update_client(use_system_proxy: bool, timeout: Duration) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .user_agent("NyaEventList-Updater")
        .connect_timeout(timeout.min(Duration::from_secs(15)))
        .timeout(timeout);
    if !use_system_proxy {
        builder = builder.no_proxy();
    }
    builder
        .build()
        .map_err(|error| format!("Could not initialize the update client: {error}"))
}

async fn successful_get(
    url: &str,
    accept: &'static str,
    label: &str,
    github_api: bool,
    timeout: Duration,
) -> Result<reqwest::Response, String> {
    let mut failures = Vec::new();
    for (use_system_proxy, connection_label) in
        [(true, "system proxy"), (false, "direct connection")]
    {
        let client = match update_client(use_system_proxy, timeout) {
            Ok(client) => client,
            Err(error) => {
                failures.push(format!("{connection_label}: {error}"));
                continue;
            }
        };
        let mut request = client
            .get(url)
            .header(ACCEPT, HeaderValue::from_static(accept));
        if github_api {
            request = request.header("X-GitHub-Api-Version", "2022-11-28");
        }
        match request.send().await {
            Ok(response) if response.status().is_success() => return Ok(response),
            Ok(response) => failures.push(format!(
                "{connection_label}: GitHub returned HTTP {}",
                response.status()
            )),
            Err(error) => failures.push(format!("{connection_label}: {error}")),
        }
    }
    Err(format!("Could not {label}; {}.", failures.join("; ")))
}

async fn response_bytes(
    mut response: reqwest::Response,
    maximum_bytes: u64,
    label: &str,
) -> Result<Vec<u8>, String> {
    let status = response.status();
    if !status.is_success() {
        return Err(format!(
            "Could not download {label}: GitHub returned HTTP {status}."
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > maximum_bytes)
    {
        return Err(format!("The {label} exceeds the allowed download size."));
    }

    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("Could not download {label}: {error}"))?
    {
        let next_length = bytes.len() as u64 + chunk.len() as u64;
        if next_length > maximum_bytes {
            return Err(format!("The {label} exceeds the allowed download size."));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

async fn download_bytes(url: &str, maximum_bytes: u64, label: &str) -> Result<Vec<u8>, String> {
    let response = successful_get(
        url,
        "application/octet-stream",
        &format!("download {label}"),
        false,
        Duration::from_secs(10 * 60),
    )
    .await?;
    response_bytes(response, maximum_bytes, label).await
}

fn release_version(release: &GitHubRelease) -> Result<Version, String> {
    let tag_version = release
        .tag_name
        .strip_prefix('v')
        .ok_or_else(|| "The latest GitHub release tag does not start with v.".to_string())?;
    parse_stable_version(tag_version, "latest GitHub release version")
}

fn validate_release_assets<'a>(
    repository: &str,
    release: &'a GitHubRelease,
) -> Result<(&'a GitHubReleaseAsset, &'a GitHubReleaseAsset), String> {
    let installer_kind = current_installer_kind().ok_or_else(|| {
        "Could not determine which Windows installer owns this application.".to_string()
    })?;
    let installer = select_windows_installer(&release.assets, installer_kind).ok_or_else(|| {
        "The latest GitHub release has no compatible Windows installer.".to_string()
    })?;
    let checksums = release
        .assets
        .iter()
        .find(|asset| asset.name == "SHA256SUMS")
        .ok_or_else(|| "The latest GitHub release has no SHA256SUMS asset.".to_string())?;

    validate_release_asset(repository, installer, MAX_INSTALLER_BYTES)?;
    validate_release_asset(repository, checksums, MAX_CHECKSUM_BYTES)?;
    Ok((installer, checksums))
}

fn validate_release_asset(
    repository: &str,
    asset: &GitHubReleaseAsset,
    maximum_bytes: u64,
) -> Result<(), String> {
    if !is_plain_file_name(&asset.name) {
        return Err("The GitHub release contains an invalid asset name.".to_string());
    }
    if asset.size > maximum_bytes {
        return Err(format!(
            "The GitHub release asset {} has an invalid size.",
            asset.name
        ));
    }
    let expected_prefix =
        format!("https://github.com/{repository}/releases/download/").to_ascii_lowercase();
    if !asset
        .browser_download_url
        .to_ascii_lowercase()
        .starts_with(&expected_prefix)
    {
        return Err(format!(
            "The download URL for {} is not owned by the configured GitHub repository.",
            asset.name
        ));
    }
    Ok(())
}

fn select_windows_installer(
    assets: &[GitHubReleaseAsset],
    installer_kind: WindowsInstallerKind,
) -> Option<&GitHubReleaseAsset> {
    let architecture_markers: &[&str] = match std::env::consts::ARCH {
        "x86_64" => &["_x64"],
        "x86" => &["_x86"],
        "aarch64" => &["_aarch64", "_arm64"],
        _ => return None,
    };

    assets
        .iter()
        .filter(|asset| {
            let name = asset.name.to_ascii_lowercase();
            name.starts_with("nyaeventlist_")
                && architecture_markers
                    .iter()
                    .any(|marker| name.contains(marker))
                && match installer_kind {
                    WindowsInstallerKind::Msi => name.ends_with(".msi"),
                    WindowsInstallerKind::Nsis => name.ends_with("-setup.exe"),
                }
        })
        .next()
}

#[cfg(windows)]
fn current_installer_kind() -> Option<WindowsInstallerKind> {
    current_windows_installer_kind()
}

#[cfg(not(windows))]
fn current_installer_kind() -> Option<WindowsInstallerKind> {
    None
}

fn checksum_for_file(checksums: &str, file_name: &str) -> Option<String> {
    checksums.lines().find_map(|line| {
        let line = line.trim_end_matches('\r');
        if line.len() < 66 {
            return None;
        }
        let checksum = &line[..64];
        if !checksum.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return None;
        }
        let separator = &line[64..66];
        if separator != "  " && separator != " *" {
            return None;
        }
        (line[66..] == *file_name).then(|| checksum.to_ascii_lowercase())
    })
}

fn checksum_file_names(checksums: &str) -> Vec<String> {
    checksums
        .lines()
        .filter_map(|line| {
            let line = line.trim_end_matches('\r');
            let separator = line.get(64..66)?;
            if line.len() < 66
                || !line[..64].bytes().all(|byte| byte.is_ascii_hexdigit())
                || (separator != "  " && separator != " *")
            {
                return None;
            }
            let name = &line[66..];
            is_plain_file_name(name).then(|| name.to_string())
        })
        .collect()
}

async fn download_installer(
    asset: &GitHubReleaseAsset,
    expected_checksum: &str,
    directory: &Path,
    version: &Version,
) -> Result<PathBuf, String> {
    let extension = if asset.name.to_ascii_lowercase().ends_with(".msi") {
        "msi"
    } else {
        "exe"
    };
    let installer_path = unique_installer_path(directory, version, extension)?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&installer_path)
        .map_err(|error| format!("Could not create the update installer file: {error}"))?;

    let result = async {
        let mut response = successful_get(
            &asset.browser_download_url,
            "application/octet-stream",
            "download the update installer",
            false,
            Duration::from_secs(10 * 60),
        )
        .await?;
        let status = response.status();
        if !status.is_success() {
            return Err(format!(
                "Could not download the update installer: GitHub returned HTTP {status}."
            ));
        }
        if response
            .content_length()
            .is_some_and(|length| length > MAX_INSTALLER_BYTES)
        {
            return Err("The update installer exceeds the allowed download size.".to_string());
        }

        let mut total_bytes = 0_u64;
        let mut hasher = Sha256::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| format!("Could not download the update installer: {error}"))?
        {
            total_bytes = total_bytes.saturating_add(chunk.len() as u64);
            if total_bytes > MAX_INSTALLER_BYTES {
                return Err("The update installer exceeds the allowed download size.".to_string());
            }
            hasher.update(&chunk);
            file.write_all(&chunk)
                .map_err(|error| format!("Could not write the update installer: {error}"))?;
        }
        file.flush()
            .map_err(|error| format!("Could not finish writing the update installer: {error}"))?;
        if total_bytes == 0 || (asset.size != 0 && total_bytes != asset.size) {
            return Err(
                "The downloaded installer size does not match the GitHub release metadata."
                    .to_string(),
            );
        }

        let actual_checksum = format!("{:x}", hasher.finalize());
        if actual_checksum != expected_checksum {
            return Err("The downloaded installer failed SHA-256 verification.".to_string());
        }
        Ok(())
    }
    .await;

    if let Err(error) = result {
        drop(file);
        let _ = fs::remove_file(&installer_path);
        return Err(error);
    }
    Ok(installer_path)
}

fn unique_installer_path(
    directory: &Path,
    version: &Version,
    extension: &str,
) -> Result<PathBuf, String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    for attempt in 0..8 {
        let candidate = directory.join(format!(
            "NyaEventList-{version}-{timestamp}-{attempt}.{extension}"
        ));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err("Could not allocate a unique update installer path.".to_string())
}

#[cfg(windows)]
fn launch_installer(path: &Path) -> Result<(), String> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    let mut command = if extension.eq_ignore_ascii_case("msi") {
        let mut command = Command::new("msiexec.exe");
        command.arg("/i").arg(path);
        command
    } else if extension.eq_ignore_ascii_case("exe") {
        Command::new(path)
    } else {
        return Err("The downloaded update is not a supported Windows installer.".to_string());
    };

    command
        .spawn()
        .map_err(|error| format!("Could not start the update installer: {error}"))?;
    Ok(())
}

#[cfg(not(windows))]
fn launch_installer(_path: &Path) -> Result<(), String> {
    Err("Automatic updates are unavailable on this platform.".to_string())
}

fn validate_repository(repository: &str) -> Result<(), String> {
    let mut parts = repository.split('/');
    let owner = parts.next().unwrap_or_default();
    let name = parts.next().unwrap_or_default();
    if parts.next().is_some()
        || owner.is_empty()
        || name.is_empty()
        || !owner.chars().all(is_repository_character)
        || !name.chars().all(is_repository_character)
    {
        return Err("The configured GitHub update repository is invalid.".to_string());
    }
    Ok(())
}

fn is_repository_character(character: char) -> bool {
    character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
}

fn is_plain_file_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 240
        && Path::new(name)
            .file_name()
            .is_some_and(|file_name| file_name == name)
}

fn truncate_text(value: &str, maximum_characters: usize) -> String {
    if value.chars().count() <= maximum_characters {
        return value.to_string();
    }
    value.chars().take(maximum_characters).collect()
}

#[cfg(windows)]
fn current_windows_installer_kind() -> Option<WindowsInstallerKind> {
    use winreg::enums::{
        HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_32KEY, KEY_WOW64_64KEY,
    };
    use winreg::RegKey;

    let Ok(current_executable) = std::env::current_exe() else {
        return None;
    };
    let uninstall_key = r"Software\Microsoft\Windows\CurrentVersion\Uninstall";

    for hive in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
        for view in [KEY_WOW64_64KEY, KEY_WOW64_32KEY] {
            let root = RegKey::predef(hive);
            let Ok(uninstall_entries) = root.open_subkey_with_flags(uninstall_key, KEY_READ | view)
            else {
                continue;
            };
            for entry_name in uninstall_entries.enum_keys().filter_map(Result::ok) {
                let Ok(entry) = uninstall_entries.open_subkey_with_flags(entry_name, KEY_READ)
                else {
                    continue;
                };
                let display_name = entry
                    .get_value::<String, _>("DisplayName")
                    .unwrap_or_default();
                if !display_name.trim().eq_ignore_ascii_case(PRODUCT_NAME) {
                    continue;
                }
                let install_location = entry.get_value::<String, _>("InstallLocation").ok();
                let display_icon = entry.get_value::<String, _>("DisplayIcon").ok();
                if registry_entry_matches_executable(
                    &current_executable,
                    install_location.as_deref(),
                    display_icon.as_deref(),
                ) {
                    let windows_installer = entry
                        .get_value::<u32, _>("WindowsInstaller")
                        .is_ok_and(|value| value == 1);
                    let uninstall_string = entry
                        .get_value::<String, _>("UninstallString")
                        .unwrap_or_default();
                    return Some(
                        if windows_installer
                            || uninstall_string.to_ascii_lowercase().contains("msiexec")
                        {
                            WindowsInstallerKind::Msi
                        } else {
                            WindowsInstallerKind::Nsis
                        },
                    );
                }
            }
        }
    }
    None
}

#[cfg(windows)]
fn registry_entry_matches_executable(
    executable: &Path,
    install_location: Option<&str>,
    display_icon: Option<&str>,
) -> bool {
    let executable = normalize_windows_path(executable);
    if let Some(location) = install_location
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let location = normalize_windows_path(Path::new(location));
        if executable == location || executable.starts_with(&format!("{location}\\")) {
            return true;
        }
    }
    display_icon
        .and_then(display_icon_path)
        .is_some_and(|icon| normalize_windows_path(Path::new(icon)) == executable)
}

#[cfg(windows)]
fn display_icon_path(value: &str) -> Option<&str> {
    let value = value.trim();
    if let Some(quoted) = value.strip_prefix('"') {
        return quoted.split_once('"').map(|(path, _)| path);
    }
    value
        .split(',')
        .next()
        .map(str::trim)
        .filter(|path| !path.is_empty())
}

#[cfg(windows)]
fn normalize_windows_path(path: &Path) -> String {
    path.to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_ascii_lowercase()
}

#[cfg(test)]
mod tests {
    use super::{
        checksum_file_names, checksum_for_file, classify_update, release_from_web_url,
        release_version, select_windows_installer, truncate_text, validate_repository,
        GitHubRelease, GitHubReleaseAsset, UpdateCheckResult, UpdateSupportReason,
        WindowsInstallerKind,
    };

    fn asset(name: &str) -> GitHubReleaseAsset {
        GitHubReleaseAsset {
            name: name.to_string(),
            browser_download_url: format!(
                "https://github.com/stevennight/NyaEventList/releases/download/v2.0.0/{name}"
            ),
            size: 42,
        }
    }

    #[test]
    fn parses_stable_release_tags() {
        let release = GitHubRelease {
            tag_name: "v2.3.4".to_string(),
            name: None,
            body: None,
            published_at: None,
            draft: false,
            prerelease: false,
            assets: Vec::new(),
        };
        assert_eq!(release_version(&release).unwrap().to_string(), "2.3.4");
    }

    #[test]
    fn version_checks_do_not_depend_on_installer_metadata() {
        let release = GitHubRelease {
            tag_name: "v2.0.0".to_string(),
            name: Some("NyaEventList v2.0.0".to_string()),
            body: Some("Release notes".to_string()),
            published_at: Some("2026-07-19T00:00:00Z".to_string()),
            draft: false,
            prerelease: false,
            assets: Vec::new(),
        };

        assert!(matches!(
            classify_update("1.0.5", &release).unwrap(),
            UpdateCheckResult::Available { version, .. } if version == "2.0.0"
        ));
    }

    #[test]
    fn serializes_every_update_result_field_as_camel_case() {
        assert_eq!(
            serde_json::to_value(UpdateCheckResult::Unsupported {
                current_version: "1.0.5".to_string(),
                reason: UpdateSupportReason::NotInstalled,
            })
            .unwrap(),
            serde_json::json!({
                "status": "unsupported",
                "currentVersion": "1.0.5",
                "reason": "notInstalled",
            })
        );
        assert_eq!(
            serde_json::to_value(UpdateCheckResult::UpToDate {
                current_version: "1.0.5".to_string(),
            })
            .unwrap(),
            serde_json::json!({
                "status": "upToDate",
                "currentVersion": "1.0.5",
            })
        );
        assert_eq!(
            serde_json::to_value(UpdateCheckResult::Available {
                current_version: "1.0.5".to_string(),
                version: "1.0.6".to_string(),
                release_name: "NyaEventList v1.0.6".to_string(),
                release_notes: "Fixes".to_string(),
                published_at: "2026-07-19T00:00:00Z".to_string(),
            })
            .unwrap(),
            serde_json::json!({
                "status": "available",
                "currentVersion": "1.0.5",
                "version": "1.0.6",
                "releaseName": "NyaEventList v1.0.6",
                "releaseNotes": "Fixes",
                "publishedAt": "2026-07-19T00:00:00Z",
            })
        );
    }

    #[test]
    fn parses_the_trusted_latest_release_redirect() {
        let release = release_from_web_url(
            "stevennight/NyaEventList",
            "https://github.com/stevennight/NyaEventList/releases/tag/v2.3.4",
        )
        .unwrap();
        assert_eq!(release.tag_name, "v2.3.4");

        assert!(release_from_web_url(
            "stevennight/NyaEventList",
            "https://example.com/stevennight/NyaEventList/releases/tag/v2.3.4",
        )
        .is_err());
        assert!(release_from_web_url(
            "stevennight/NyaEventList",
            "https://github.com/other/project/releases/tag/v2.3.4",
        )
        .is_err());
        assert!(release_from_web_url(
            "stevennight/NyaEventList",
            "https://github.com/stevennight/NyaEventList/releases/tag/latest",
        )
        .is_err());
    }

    #[test]
    fn rejects_untrusted_repository_shapes() {
        assert!(validate_repository("stevennight/NyaEventList").is_ok());
        assert!(validate_repository("https://github.com/stevennight/NyaEventList").is_err());
        assert!(validate_repository("owner/repo/extra").is_err());
        assert!(validate_repository("owner/repo?redirect=elsewhere").is_err());
    }

    #[test]
    fn finds_exact_sha256sum_file_names() {
        let hash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let checksums = format!("{hash}  NyaEventList_2.0.0_x64-setup.exe\n{hash} *other.msi\n");
        assert_eq!(
            checksum_for_file(&checksums, "NyaEventList_2.0.0_x64-setup.exe"),
            Some(hash.to_string())
        );
        assert_eq!(checksum_for_file(&checksums, "missing.exe"), None);
        assert_eq!(
            checksum_file_names(&checksums),
            vec![
                "NyaEventList_2.0.0_x64-setup.exe".to_string(),
                "other.msi".to_string()
            ]
        );
        assert!(checksum_file_names(&format!("{hash}  ../unsafe.exe\ninvalid")).is_empty());
    }

    #[test]
    fn selects_the_installer_type_used_by_the_current_installation() {
        let architecture = std::env::consts::ARCH;
        let marker = match architecture {
            "x86_64" => "x64",
            "x86" => "x86",
            "aarch64" => "aarch64",
            _ => return,
        };
        let assets = vec![
            asset(&format!("NyaEventList_2.0.0_{marker}_en-US.msi")),
            asset(&format!("NyaEventList_2.0.0_{marker}-setup.exe")),
        ];
        assert!(
            select_windows_installer(&assets, WindowsInstallerKind::Nsis)
                .unwrap()
                .name
                .ends_with("-setup.exe")
        );
        assert!(select_windows_installer(&assets, WindowsInstallerKind::Msi)
            .unwrap()
            .name
            .ends_with(".msi"));
    }

    #[test]
    fn truncates_release_notes_at_character_boundaries() {
        assert_eq!(truncate_text("版本更新说明", 4), "版本更新");
    }

    #[cfg(windows)]
    #[test]
    fn registry_paths_must_match_the_running_install_location() {
        use super::registry_entry_matches_executable;
        use std::path::Path;

        let executable = Path::new(r"C:\Users\Test\AppData\Local\NyaEventList\NyaEventList.exe");
        assert!(registry_entry_matches_executable(
            executable,
            Some(r"C:\Users\Test\AppData\Local\NyaEventList"),
            None,
        ));
        assert!(registry_entry_matches_executable(
            executable,
            None,
            Some(r#""C:\Users\Test\AppData\Local\NyaEventList\NyaEventList.exe",0"#),
        ));
        assert!(!registry_entry_matches_executable(
            executable,
            Some(r"D:\Portable\NyaEventList"),
            None,
        ));
    }
}
