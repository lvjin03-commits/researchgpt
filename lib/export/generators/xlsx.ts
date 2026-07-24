import * as XLSX from "xlsx";
import { buildArtifactSpec } from "@/lib/export/artifact-spec";

type CellValue = string | number | boolean | null;

type SheetSpec = {
  name: string;
  headers: string[];
  rows: CellValue[][];
};

type WorkbookSpec = {
  sheets: SheetSpec[];
};

function safeSheetName(value: string, fallback: string): string {
  const cleaned = value.replace(/[\\/?*[\]:]/g, " ").trim();
  return (cleaned || fallback).slice(0, 31);
}

function normalizeHeader(value: unknown, index: number): string {
  const header = String(value ?? "").replace(/\s+/g, " ").trim();
  return header || `字段${index + 1}`;
}

function normalizeCell(value: unknown): CellValue {
  if (value === null || value === undefined) return "";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return JSON.stringify(value);
}

function uniqueHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((header, index) => {
    const base = normalizeHeader(header, index);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  });
}

function alignRow(row: unknown[], width: number): CellValue[] {
  return Array.from({ length: width }, (_, index) => normalizeCell(row[index]));
}

function normalizeRows(
  rows: unknown[],
  headers: string[],
): { headers: string[]; rows: CellValue[][] } {
  const headerSet = new Set(headers);
  const objectKeys: string[] = [...headers];

  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    for (const key of Object.keys(row)) {
      if (!headerSet.has(key)) {
        headerSet.add(key);
        objectKeys.push(key);
      }
    }
  }

  const finalHeaders = uniqueHeaders(objectKeys.length > 0 ? objectKeys : headers);
  const finalRows = rows.map((row) => {
    if (Array.isArray(row)) return alignRow(row, finalHeaders.length);
    if (row && typeof row === "object") {
      const record = row as Record<string, unknown>;
      return finalHeaders.map((header) => normalizeCell(record[header]));
    }
    return [normalizeCell(row), ...Array(finalHeaders.length - 1).fill("")];
  });

  return { headers: finalHeaders, rows: finalRows };
}

function sheetFromUnknown(
  value: unknown,
  fallbackName: string,
): SheetSpec | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const name =
    typeof record.name === "string"
      ? record.name
      : typeof record.title === "string"
        ? record.title
        : fallbackName;
  const rawRows = Array.isArray(record.rows)
    ? record.rows
    : Array.isArray(record.data)
      ? record.data
      : [];
  const rawHeaders = Array.isArray(record.headers)
    ? record.headers
    : Array.isArray(record.columns)
      ? record.columns
      : [];

  if (rawRows.length === 0 && rawHeaders.length === 0) return null;
  const inferredHeaders =
    rawHeaders.length > 0
      ? rawHeaders.map((item, index) => normalizeHeader(item, index))
      : inferHeadersFromRows(rawRows);
  const normalized = normalizeRows(rawRows, inferredHeaders);
  return { name, headers: normalized.headers, rows: normalized.rows };
}

function inferHeadersFromRows(rows: unknown[]): string[] {
  const firstObject = rows.find(
    (row) => row && typeof row === "object" && !Array.isArray(row),
  ) as Record<string, unknown> | undefined;
  if (firstObject) return Object.keys(firstObject).map(normalizeHeader);

  const firstArray = rows.find(Array.isArray) as unknown[] | undefined;
  if (firstArray && firstArray.length > 0) {
    return firstArray.map((_, index) => `字段${index + 1}`);
  }

  return ["内容"];
}

function extractFencedBlocks(content: string): Array<{ language: string; body: string }> {
  const blocks: Array<{ language: string; body: string }> = [];
  const pattern = /```([a-zA-Z0-9_-]*)\s*\n([\s\S]*?)```/g;
  for (const match of content.matchAll(pattern)) {
    const body = match[2]?.trim();
    if (body) {
      blocks.push({ language: (match[1] ?? "").toLowerCase(), body });
    }
  }
  return blocks;
}

function parseJsonWorkbook(content: string, title: string): WorkbookSpec | null {
  const blocks = extractFencedBlocks(content)
    .filter((block) => /^(json|xlsx|excel)$/i.test(block.language))
    .map((block) => block.body);
  const trimmed = content.trim();
  const candidates = [
    ...blocks,
    ...(trimmed.startsWith("{") || trimmed.startsWith("[") ? [trimmed] : []),
  ];

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const workbook = normalizeJsonWorkbook(parsed, title);
      if (workbook && workbook.sheets.length > 0) return workbook;
    } catch {
      continue;
    }
  }

  return null;
}

function normalizeJsonWorkbook(parsed: unknown, title: string): WorkbookSpec | null {
  if (Array.isArray(parsed)) {
    const sheet = sheetFromUnknown({ name: title, rows: parsed }, title);
    return sheet ? { sheets: [sheet] } : null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;

  if (Array.isArray(record.sheets)) {
    const sheets = record.sheets
      .map((sheet, index) => sheetFromUnknown(sheet, `表格${index + 1}`))
      .filter((sheet): sheet is SheetSpec => Boolean(sheet));
    return sheets.length > 0 ? { sheets } : null;
  }

  const directSheet = sheetFromUnknown(record, title);
  if (directSheet) return { sheets: [directSheet] };

  const arrayEntry = Object.entries(record).find(([, value]) => Array.isArray(value));
  if (arrayEntry) {
    const [name, rows] = arrayEntry;
    const sheet = sheetFromUnknown({ name, rows }, name);
    return sheet ? { sheets: [sheet] } : null;
  }

  return null;
}

function detectDelimiter(lines: string[]): string {
  const candidates = ["\t", ",", ";"];
  return candidates
    .map((delimiter) => ({
      delimiter,
      score: lines
        .slice(0, 5)
        .reduce((total, line) => total + parseDelimitedLine(line, delimiter).length, 0),
    }))
    .sort((a, b) => b.score - a.score)[0]?.delimiter ?? ",";
}

function parseDelimitedLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function parseDelimitedSheets(content: string, title: string): SheetSpec[] {
  const blocks = extractFencedBlocks(content).filter((block) =>
    /^(csv|tsv|xlsx|excel)$/i.test(block.language),
  );
  const sources =
    blocks.length > 0
      ? blocks.map((block, index) => ({
          name: index === 0 ? title : `表格${index + 1}`,
          body: block.body,
          delimiter: block.language === "tsv" ? "\t" : undefined,
        }))
      : [{ name: title, body: content, delimiter: undefined }];

  return sources
    .map((source) => {
      const lines = source.body
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      if (lines.length < 2) return null;
      const delimiter = source.delimiter ?? detectDelimiter(lines);
      const parsed = lines.map((line) => parseDelimitedLine(line, delimiter));
      if (Math.max(...parsed.map((row) => row.length)) < 2) return null;
      const headers = uniqueHeaders(parsed[0].map(normalizeHeader));
      const rows = parsed.slice(1).map((row) => alignRow(row, headers.length));
      return { name: source.name, headers, rows };
    })
    .filter((sheet): sheet is SheetSpec => Boolean(sheet));
}

function parseMarkdownSheets(content: string): SheetSpec[] {
  const artifact = buildArtifactSpec("Excel", content);
  return artifact.tables.map((table, index) => ({
    name: table.title || `表格${index + 1}`,
    headers: uniqueHeaders(table.headers.map(normalizeHeader)),
    rows: table.rows.map((row) => alignRow(row, table.headers.length)),
  }));
}

function splitLongText(value: string): string[] {
  return value
    .replace(/\r\n/g, "\n")
    .split(/\n+|[；;。](?=\s*[\u4e00-\u9fa5A-Za-z0-9])/)
    .map((item) => item.replace(/^[-*•\d.、\s]+/, "").trim())
    .filter(Boolean);
}

function repairFreeTextWorkbook(title: string, content: string): WorkbookSpec {
  const artifact = buildArtifactSpec(title, content);
  const rows: CellValue[][] = [];

  for (const section of artifact.sections) {
    const entries = [...section.paragraphs, ...section.bullets];
    for (const entry of entries) {
      const parts = splitLongText(entry);
      if (parts.length === 0) continue;
      for (const part of parts) {
        const colonIndex = part.search(/[:：]/);
        if (colonIndex > 0 && colonIndex < 30) {
          rows.push([
            section.title,
            part.slice(0, colonIndex).trim(),
            part.slice(colonIndex + 1).trim(),
          ]);
        } else {
          rows.push([section.title, "内容", part]);
        }
      }
    }
  }

  if (rows.length === 0) {
    const lines = content
      .replace(/```[\s\S]*?```/g, "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    lines.forEach((line, index) => rows.push([index + 1, "内容", line]));
  }

  return {
    sheets: [
      {
        name: "结构化内容",
        headers: ["章节", "项目", "内容"],
        rows,
      },
    ],
  };
}

function isSheetHealthy(sheet: SheetSpec): boolean {
  if (sheet.headers.length < 2 || sheet.rows.length < 1) return false;

  const rowCount = sheet.rows.length;
  const badRows = sheet.rows.filter((row) => {
    const nonEmpty = row.filter((cell) => String(cell ?? "").trim().length > 0);
    const longest = nonEmpty.reduce<number>(
      (max, cell) => Math.max(max, String(cell ?? "").length),
      0,
    );
    return nonEmpty.length <= 1 && longest > 80;
  }).length;

  return badRows / rowCount <= 0.35;
}

function repairUnhealthySheets(workbook: WorkbookSpec, title: string): WorkbookSpec {
  const healthySheets = workbook.sheets.filter(isSheetHealthy);
  if (healthySheets.length === workbook.sheets.length) return workbook;

  const repaired = workbook.sheets.map((sheet) => {
    if (isSheetHealthy(sheet)) return sheet;
    const rows = sheet.rows.flatMap((row, rowIndex) => {
      const text = row.map((cell) => String(cell ?? "").trim()).filter(Boolean).join(" ");
      const parts = splitLongText(text);
      return (parts.length > 0 ? parts : [text]).map((part, partIndex) => [
        rowIndex + 1,
        partIndex + 1,
        part,
      ]);
    });
    return {
      name: sheet.name || title,
      headers: ["原行", "序号", "内容"],
      rows,
    };
  });

  return { sheets: repaired };
}

function buildWorkbookSpec(title: string, content: string): WorkbookSpec {
  const structured =
    parseJsonWorkbook(content, title) ??
    ({ sheets: parseDelimitedSheets(content, title) } satisfies WorkbookSpec);
  const markdownSheets = parseMarkdownSheets(content);
  const workbook =
    structured.sheets.length > 0
      ? structured
      : markdownSheets.length > 0
        ? { sheets: markdownSheets }
        : repairFreeTextWorkbook(title, content);

  const repaired = repairUnhealthySheets(workbook, title);
  if (repaired.sheets.some(isSheetHealthy)) return repaired;
  return repairFreeTextWorkbook(title, content);
}

function columnWidth(values: unknown[]): number {
  const longest = values.reduce<number>(
    (max, value) => Math.max(max, String(value ?? "").length),
    0,
  );
  return Math.min(52, Math.max(12, longest + 3));
}

function appendSheet(
  workbook: XLSX.WorkBook,
  usedSheetNames: Set<string>,
  sheetSpec: SheetSpec,
  index: number,
): void {
  const headers = uniqueHeaders(sheetSpec.headers);
  const rows = sheetSpec.rows.map((row) => alignRow(row, headers.length));
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  worksheet["!cols"] = headers.map((header, columnIndex) => ({
    wch: columnWidth([header, ...rows.map((row) => row[columnIndex] ?? "")]),
  }));
  worksheet["!autofilter"] = {
    ref: `A1:${XLSX.utils.encode_col(Math.max(headers.length - 1, 0))}${
      rows.length + 1
    }`,
  };
  worksheet["!freeze"] = { xSplit: 0, ySplit: 1 };

  const baseName = safeSheetName(sheetSpec.name, `表格${index + 1}`);
  let sheetName = baseName;
  let suffix = 2;
  while (usedSheetNames.has(sheetName)) {
    const suffixText = `-${suffix}`;
    sheetName = `${baseName.slice(0, 31 - suffixText.length)}${suffixText}`;
    suffix += 1;
  }
  usedSheetNames.add(sheetName);
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
}

export function generateArtifactXlsxBuffer(
  title: string,
  content: string,
): Buffer {
  const workbookSpec = buildWorkbookSpec(title, content);
  const workbook = XLSX.utils.book_new();
  const usedSheetNames = new Set<string>();

  workbookSpec.sheets.forEach((sheet, index) => {
    appendSheet(workbook, usedSheetNames, sheet, index);
  });

  return XLSX.write(workbook, {
    bookType: "xlsx",
    type: "buffer",
    compression: true,
  }) as Buffer;
}
