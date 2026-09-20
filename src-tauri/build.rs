fn main() {
    // 这些变量由发布工作流注入，变了就必须重新编译，否则会带着旧版本号
    for variable in [
        "NYAEVENTLIST_VERSION",
        "NYAEVENTLIST_COMMIT",
        "NYAEVENTLIST_BUILD_DATE",
        "NYAEVENTLIST_UPDATE_REPOSITORY",
    ] {
        println!("cargo:rerun-if-env-changed={variable}");
    }

    tauri_build::build()
}
