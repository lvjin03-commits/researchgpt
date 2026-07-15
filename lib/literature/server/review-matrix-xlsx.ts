import * as XLSX from "xlsx";
import { LiteratureError } from "@/lib/literature/errors";
import type { LiteratureMatrixRow } from "@/lib/literature/review/types";

const MATRIX_COLUMNS: Array<{
  header: string;
  key: keyof LiteratureMatrixRow;
  width: number;
}> = [
  { header: "是否纳入", key: "included", width: 10 },
  { header: "文献名称", key: "citation", width: 42 },
  { header: "研究主题", key: "researchTopic", width: 28 },
  { header: "研究问题", key: "researchProblem", width: 34 },
  { header: "研究对象", key: "researchObject", width: 24 },
  { header: "研究方法", key: "researchMethod", width: 34 },
  { header: "关键结果", key: "keyResults", width: 42 },
  { header: "主要结论", key: "conclusion", width: 38 },
  { header: "核心思想", key: "coreIdea", width: 38 },
  { header: "局限性", key: "limitations", width: 34 },
  { header: "与汇报的关系", key: "reviewRelation", width: 38 },
  { header: "证据状态", key: "evidenceLevel", width: 14 },
];

function parseMatrixRows(content: string): LiteratureMatrixRow[] {
  let value: unknown;
  try {
    value = JSON.parse(content) as unknown;
  } catch {
    throw new LiteratureError("文献矩阵数据无效，无法导出。", 400);
  }

  if (!Array.isArray(value) || value.length === 0) {
    throw new LiteratureError("暂无可导出的文献矩阵。", 400);
  }

  return value as LiteratureMatrixRow[];
}

function displayCellValue(
  row: LiteratureMatrixRow,
  key: keyof LiteratureMatrixRow,
): string {
  if (key === "included") {
    return row.included ? "是" : "否";
  }
  if (key === "evidenceLevel") {
    return row.evidenceLevel === "full_text" ? "全文已分析" : "仅摘要";
  }

  return String(row[key] ?? "");
}

export function generateLiteratureMatrixXlsxBuffer(content: string): Buffer {
  const rows = parseMatrixRows(content);
  const data = [
    MATRIX_COLUMNS.map((column) => column.header),
    ...rows.map((row) =>
      MATRIX_COLUMNS.map((column) => displayCellValue(row, column.key)),
    ),
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(data);

  worksheet["!cols"] = MATRIX_COLUMNS.map((column) => ({ wch: column.width }));
  worksheet["!autofilter"] = { ref: `A1:L${rows.length + 1}` };
  worksheet["!freeze"] = { xSplit: 0, ySplit: 1 };

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "文献矩阵");

  return XLSX.write(workbook, {
    bookType: "xlsx",
    type: "buffer",
    compression: true,
  }) as Buffer;
}
