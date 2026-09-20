import * as XLSX from "xlsx";
import { EXPORT_COLUMNS, type ExportRow } from "./rows";

export function toXlsx(rows: ExportRow[], sheetName = "明细"): Uint8Array {
  const ws = XLSX.utils.json_to_sheet(rows, { header: [...EXPORT_COLUMNS] });
  ws["!cols"] = [8, 34, 14, 14, 12, 14, 40, 11, 9, 9, 7].map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
}
