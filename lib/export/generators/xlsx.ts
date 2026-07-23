import * as XLSX from "xlsx";
import { buildArtifactSpec } from "@/lib/export/artifact-spec";

function safeSheetName(value: string, fallback: string): string {
  const cleaned = value.replace(/[\\/?*[\]:]/g, " ").trim();
  return (cleaned || fallback).slice(0, 31);
}

function columnWidth(values: unknown[]): number {
  const longest = values.reduce<number>(
    (max, value) => Math.max(max, String(value ?? "").length),
    0,
  );
  return Math.min(60, Math.max(14, longest + 4));
}

export function generateArtifactXlsxBuffer(
  title: string,
  content: string,
): Buffer {
  const artifact = buildArtifactSpec(title, content);
  const workbook = XLSX.utils.book_new();
  const usedSheetNames = new Set<string>(["成果概览"]);

  const overviewRows = [
    ["成果名称", artifact.title],
    ["摘要", artifact.summary],
    [],
    ["章节", "内容"],
    ...artifact.sections.map((section) => [
      section.title,
      [...section.paragraphs, ...section.bullets].join("\n"),
    ]),
  ];

  const overview = XLSX.utils.aoa_to_sheet(overviewRows);
  overview["!cols"] = [{ wch: 28 }, { wch: 88 }];
  overview["!freeze"] = { xSplit: 0, ySplit: 4 };
  XLSX.utils.book_append_sheet(workbook, overview, "成果概览");

  artifact.tables.forEach((table, index) => {
    const rows = [table.headers, ...table.rows];
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet["!cols"] = table.headers.map((header, columnIndex) => ({
      wch: columnWidth([
        header,
        ...table.rows.map((row) => row[columnIndex] ?? ""),
      ]),
    }));
    sheet["!autofilter"] = {
      ref: `A1:${XLSX.utils.encode_col(Math.max(table.headers.length - 1, 0))}${
        table.rows.length + 1
      }`,
    };
    sheet["!freeze"] = { xSplit: 0, ySplit: 1 };

    const baseName = safeSheetName(table.title, `表格${index + 1}`);
    let sheetName = baseName;
    let suffix = 2;
    while (usedSheetNames.has(sheetName)) {
      const suffixText = `-${suffix}`;
      sheetName = `${baseName.slice(0, 31 - suffixText.length)}${suffixText}`;
      suffix += 1;
    }
    usedSheetNames.add(sheetName);
    XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  });

  return XLSX.write(workbook, {
    bookType: "xlsx",
    type: "buffer",
    compression: true,
  }) as Buffer;
}
