import React, { useState } from 'react';
import { Upload, X, FileSpreadsheet, AlertCircle, Download } from 'lucide-react';
import {
  ColumnAliases,
  downloadSampleSpreadsheet,
  parseSpreadsheetFile,
} from '../lib/spreadsheetImport';

interface CsvImportModalProps {
  open: boolean;
  title: string;
  expectedColumns: string[];
  sampleRow: Record<string, string>;
  columnAliases?: ColumnAliases;
  templateFileName?: string;
  onClose: () => void;
  onImport: (rows: Record<string, string>[]) => Promise<void>;
}

export function CsvImportModal({
  open,
  title,
  expectedColumns,
  sampleRow,
  columnAliases,
  templateFileName = 'import-template',
  onClose,
  onImport,
}: CsvImportModalProps) {
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  if (!open) return null;

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setFileName(file.name);
    try {
      const parsed = await parseSpreadsheetFile(file, expectedColumns, columnAliases);
      if (parsed.headers.length === 0 || parsed.rows.length === 0) {
        setHeaders([]);
        setRows([]);
        setError('Spreadsheet appears empty or has no data rows beneath the header.');
        return;
      }
      setHeaders(parsed.headers);
      setRows(parsed.rows);
    } catch {
      setHeaders([]);
      setRows([]);
      setError('Unable to read spreadsheet. Please upload a valid .xlsx, .xls, or .csv file.');
    }
  };

  const handleConfirmImport = async () => {
    setImporting(true);
    setError(null);
    try {
      await onImport(rows);
      setHeaders([]);
      setRows([]);
      setFileName(null);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-900/50 p-4 no-print">
      <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-3xl w-full max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <FileSpreadsheet className="w-5 h-5 text-[#408dfb]" />
            <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close spreadsheet import"
            className="text-slate-400 hover:text-slate-700 p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 text-xs text-slate-600 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium text-slate-800">Supported Excel &amp; CSV Columns:</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    downloadSampleSpreadsheet(templateFileName, expectedColumns, [sampleRow], 'xlsx')
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-[#408dfb] bg-white border border-blue-200 rounded-md hover:bg-blue-50"
                >
                  <Download className="w-3 h-3" />
                  Sample Excel (.xlsx)
                </button>
                <button
                  type="button"
                  onClick={() =>
                    downloadSampleSpreadsheet(templateFileName, expectedColumns, [sampleRow], 'csv')
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-100"
                >
                  <Download className="w-3 h-3" />
                  Sample CSV
                </button>
              </div>
            </div>
            <p className="font-mono text-[11px] text-slate-700">{expectedColumns.join(', ')}</p>
            <p className="text-slate-500">
              Example: {expectedColumns.map((c) => sampleRow[c] ?? '').join(', ')}
            </p>
          </div>

          <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-300 rounded-lg py-8 px-4 cursor-pointer hover:border-[#408dfb] hover:bg-blue-50/30 transition-colors">
            <Upload className="w-7 h-7 text-[#408dfb] mb-2" />
            <span className="text-sm font-medium text-slate-800">
              {fileName ? `Selected: ${fileName}` : 'Choose an Excel (.xlsx / .xls) or CSV file'}
            </span>
            <span className="text-xs text-slate-500 mt-0.5">
              Supports Excel workbooks (.xlsx, .xls, .ods) and UTF-8 .csv files
            </span>
            <input
              type="file"
              accept=".xlsx,.xls,.ods,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              className="hidden"
              onChange={(e) => void handleFile(e)}
            />
          </label>

          {error && (
            <div className="flex items-center gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {rows.length > 0 && (
            <div>
              <p className="text-xs font-medium text-slate-700 mb-2">
                Preview ({rows.length} row{rows.length === 1 ? '' : 's'} detected, showing first 10):
              </p>
              <div className="border border-slate-200 rounded-lg overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      {headers.map((h) => (
                        <th key={h} className="text-left px-3 py-2 font-medium text-slate-600 whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.slice(0, 10).map((row, idx) => (
                      <tr key={idx}>
                        {headers.map((h) => (
                          <td key={h} className="px-3 py-2 text-slate-700 whitespace-nowrap">
                            {row[h]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-slate-200 flex items-center justify-end gap-2.5 bg-slate-50 rounded-b-xl">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={rows.length === 0 || importing}
            onClick={handleConfirmImport}
            className="px-4 py-2 text-xs font-medium text-white bg-[#408dfb] hover:bg-[#2f7ae5] rounded-lg disabled:opacity-50"
          >
            {importing ? 'Importing...' : `Import ${rows.length} Record(s)`}
          </button>
        </div>
      </div>
    </div>
  );
}
