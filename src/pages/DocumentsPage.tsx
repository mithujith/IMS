import React, { useCallback, useEffect, useState } from 'react';
import { Eye, FileText, FolderOpen, Search, Trash2, Upload, X } from 'lucide-react';
import { useOrg } from '../hooks/useOrg';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { StoredDocument } from '../types';
import { fetchPagedCollection } from '../services/firestoreList';
import { removeDocumentRecord, uploadDocumentRecord } from '../services/documentsService';
import { EmptyState } from '../components/EmptyState';
import { formatRelativeTime } from '../lib/formatters';

const FOLDERS = ['All', 'General', 'Invoices', 'Purchase Orders', 'Catalog', 'Compliance'];

export function DocumentsPage() {
  const { orgId, can } = useOrg();
  const { user } = useAuth();
  const { showToast } = useToast();

  const [docs, setDocs] = useState<StoredDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFolder, setActiveFolder] = useState('All');
  const [uploadFolder, setUploadFolder] = useState('General');
  const [search, setSearch] = useState('');
  const [uploading, setUploading] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<StoredDocument | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const res = await fetchPagedCollection<StoredDocument>({
        orgId,
        subcollection: 'documents',
        pageSize: 50,
      });
      setDocs(res.items);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !orgId || !user) return;
    setUploading(true);
    try {
      await uploadDocumentRecord({
        orgId,
        userId: user.uid,
        userName: user.displayName || user.email || 'User',
        folder: uploadFolder,
        file,
      });
      showToast(`Uploaded ${file.name}`, 'success');
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Upload failed', 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (docItem: StoredDocument) => {
    if (!orgId || !user) return;
    try {
      await removeDocumentRecord(
        orgId,
        docItem.id,
        docItem.storagePath,
        user.uid,
        user.displayName || user.email || 'User',
        docItem.name
      );
      showToast('Document removed', 'success');
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Delete failed', 'error');
    }
  };

  const visibleDocs = docs.filter((d) => {
    if (activeFolder !== 'All' && d.folder !== activeFolder) return false;
    if (search.trim() && !d.name.toLowerCase().includes(search.trim().toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Documents &amp; Cloud Vault</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Store supplier invoices, customs clearance PDFs, and spare parts photos (max 10 MB per file)
          </p>
        </div>

        {can('documents', 'create') && (
          <div className="flex items-center gap-2">
            <select
              value={uploadFolder}
              onChange={(e) => setUploadFolder(e.target.value)}
              aria-label="Target folder"
              className="px-2.5 py-2 text-xs bg-white border border-slate-300 rounded-lg"
            >
              {FOLDERS.filter((f) => f !== 'All').map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
            <label className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-[#408dfb] text-white rounded-lg hover:bg-[#2f7ae5] cursor-pointer">
              <Upload className="w-3.5 h-3.5" />
              {uploading ? 'Uploading...' : 'Upload File'}
              <input
                type="file"
                accept="image/*,application/pdf"
                disabled={uploading}
                onChange={handleUpload}
                className="hidden"
              />
            </label>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
        <div className="bg-white border border-slate-200 rounded-lg p-3 h-fit space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 px-2 pb-1">
            Folders
          </p>
          {FOLDERS.map((folder) => (
            <button
              key={folder}
              type="button"
              onClick={() => setActiveFolder(folder)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${
                activeFolder === folder
                  ? 'bg-[#408dfb] text-white font-semibold'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <FolderOpen className="w-3.5 h-3.5 shrink-0" />
              <span>{folder}</span>
            </button>
          ))}
        </div>

        <div className="lg:col-span-3 space-y-4">
          <div className="relative max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search documents..."
              className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
            />
          </div>

          {loading ? (
            <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-xs text-slate-500">
              Loading documents...
            </div>
          ) : visibleDocs.length === 0 ? (
            <EmptyState
              title="No documents in this folder"
              description="Upload PDFs or images up to 10 MB to share across your organization."
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {visibleDocs.map((d) => (
                <div
                  key={d.id}
                  className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col justify-between gap-3"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-blue-50 text-[#408dfb] flex items-center justify-center shrink-0">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-slate-900 truncate">{d.name}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {d.folder} · {(d.size / 1024).toFixed(0)} KB
                      </p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {d.uploadedByName} · {formatRelativeTime(d.createdAt)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                    <button
                      type="button"
                      onClick={() => setPreviewDoc(d)}
                      className="inline-flex items-center gap-1 text-[#408dfb] font-medium hover:underline"
                    >
                      <Eye className="w-3.5 h-3.5" /> Preview
                    </button>
                    {can('documents', 'delete') && (
                      <button
                        type="button"
                        onClick={() => handleDelete(d)}
                        className="inline-flex items-center gap-1 text-red-600 hover:underline"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Delete
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {previewDoc && (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-900/60 p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
              <h3 className="text-sm font-semibold text-slate-900 truncate">{previewDoc.name}</h3>
              <button type="button" onClick={() => setPreviewDoc(null)} aria-label="Close preview">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <div className="p-4 overflow-auto flex-1 bg-slate-50 flex items-center justify-center">
              {previewDoc.contentType.startsWith('image/') ? (
                <img
                  src={previewDoc.url}
                  alt={previewDoc.name}
                  referrerPolicy="no-referrer"
                  className="max-h-[75vh] object-contain rounded"
                />
              ) : (
                <iframe
                  src={previewDoc.url}
                  title={previewDoc.name}
                  className="w-full h-[75vh] bg-white rounded border border-slate-200"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
