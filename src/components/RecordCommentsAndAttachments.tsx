import React, { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { Paperclip, MessageSquare, History, Upload, ExternalLink } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { ActivityLogEntry, Attachment, CommentItem } from '../types';
import { updateOrgDoc, generateId } from '../services/firestoreList';
import { uploadAttachment } from '../services/documentsService';
import { useOrg } from '../hooks/useOrg';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { formatRelativeTime } from '../lib/formatters';

interface RecordCommentsAndAttachmentsProps {
  subcollection: string;
  recordId: string;
  comments?: CommentItem[];
  attachments?: Attachment[];
  canEdit: boolean;
  onUpdated?: () => void;
}

export function RecordCommentsAndAttachments({
  subcollection,
  recordId,
  comments = [],
  attachments = [],
  canEdit,
  onUpdated,
}: RecordCommentsAndAttachmentsProps) {
  const { orgId } = useOrg();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [commentText, setCommentText] = useState('');
  const [savingComment, setSavingComment] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [history, setHistory] = useState<ActivityLogEntry[]>([]);

  useEffect(() => {
    if (!orgId || !recordId) return;
    const path = `organizations/${orgId}/activityLog`;
    const q = query(
      collection(db, path),
      where('entityId', '==', recordId),
      orderBy('createdAt', 'desc'),
      limit(15)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setHistory(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ActivityLogEntry, 'id'>) })));
      },
      (err) => {
        if (!String(err).includes('requires an index')) {
          handleFirestoreError(err, OperationType.LIST, path);
        }
      }
    );
    return () => unsub();
  }, [orgId, recordId]);

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !user || !commentText.trim()) return;
    setSavingComment(true);
    try {
      const nextComment: CommentItem = {
        id: generateId(),
        text: commentText.trim(),
        userId: user.uid,
        userName: user.displayName || user.email || 'User',
        createdAt: new Date().toISOString(),
      };
      await updateOrgDoc(orgId, subcollection, recordId, user.uid, {
        comments: [...comments, nextComment],
      });
      setCommentText('');
      showToast('Comment added', 'success');
      onUpdated?.();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to add comment', 'error');
    } finally {
      setSavingComment(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !orgId || !user) return;
    setUploading(true);
    try {
      const att = await uploadAttachment(
        orgId,
        subcollection,
        user.displayName || user.email || 'User',
        file
      );
      await updateOrgDoc(orgId, subcollection, recordId, user.uid, {
        attachments: [...attachments, att],
      });
      showToast('Attachment uploaded', 'success');
      onUpdated?.();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Upload failed', 'error');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-5 pt-5 border-t border-slate-200">
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
            <Paperclip className="w-3.5 h-3.5 text-slate-500" />
            Attachments ({attachments.length})
          </h4>
          {canEdit && (
            <label className="inline-flex items-center gap-1 text-xs font-medium text-[#408dfb] hover:underline cursor-pointer">
              <Upload className="w-3.5 h-3.5" />
              {uploading ? 'Uploading...' : 'Attach'}
              <input
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                disabled={uploading}
                onChange={handleFileUpload}
              />
            </label>
          )}
        </div>
        {attachments.length === 0 ? (
          <p className="text-xs text-slate-400">No files attached yet.</p>
        ) : (
          <ul className="space-y-2">
            {attachments.map((att) => (
              <li key={att.id} className="flex items-center justify-between text-xs bg-slate-50 px-2.5 py-2 rounded">
                <span className="truncate text-slate-700 max-w-[180px]">{att.name}</span>
                <a
                  href={att.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#408dfb] hover:underline inline-flex items-center gap-1 shrink-0"
                >
                  Open <ExternalLink className="w-3 h-3" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <h4 className="text-xs font-semibold text-slate-900 flex items-center gap-1.5 mb-3">
          <MessageSquare className="w-3.5 h-3.5 text-slate-500" />
          Comments ({comments.length})
        </h4>
        <div className="space-y-2 max-h-40 overflow-y-auto mb-3">
          {comments.length === 0 ? (
            <p className="text-xs text-slate-400">No comments yet.</p>
          ) : (
            comments.map((c) => (
              <div key={c.id} className="bg-slate-50 rounded p-2 text-xs">
                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span className="font-medium text-slate-700">{c.userName}</span>
                  <span>{formatRelativeTime(c.createdAt)}</span>
                </div>
                <p className="text-slate-700 mt-1">{c.text}</p>
              </div>
            ))
          )}
        </div>
        {canEdit && (
          <form onSubmit={handleAddComment} className="flex gap-1.5">
            <input
              type="text"
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="Add an internal note..."
              className="flex-1 px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:border-[#408dfb]"
            />
            <button
              type="submit"
              disabled={savingComment || !commentText.trim()}
              className="px-3 py-1.5 text-xs font-medium text-white bg-[#408dfb] rounded-lg disabled:opacity-50"
            >
              Post
            </button>
          </form>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <h4 className="text-xs font-semibold text-slate-900 flex items-center gap-1.5 mb-3">
          <History className="w-3.5 h-3.5 text-slate-500" />
          Activity History
        </h4>
        {history.length === 0 ? (
          <p className="text-xs text-slate-400">Activity log updates in real time.</p>
        ) : (
          <ul className="space-y-2 max-h-44 overflow-y-auto">
            {history.map((h) => (
              <li key={h.id} className="text-xs border-b border-slate-100 pb-1.5 last:border-0">
                <p className="font-medium text-slate-800">{h.action}</p>
                <p className="text-[11px] text-slate-500">
                  {h.userName} · {formatRelativeTime(h.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
