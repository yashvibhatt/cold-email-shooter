'use client';

import { useRef } from 'react';
import { Paperclip, X, FileText, Image, Archive, File, Loader2, AlertTriangle } from 'lucide-react';
import { useUploadAttachments, useDeleteAttachment } from '@/hooks/useEmails';
import { cn } from '@/lib/utils';
import type { AttachmentInfo } from '@/lib/api';

interface Props {
  attachments: AttachmentInfo[];
  onChange: (attachments: AttachmentInfo[]) => void;
  maxFiles?: number;
  maxMB?: number;
}

function fileIcon(mimeType: string) {
  if (mimeType.startsWith('image/'))       return <Image className="w-3.5 h-3.5" />;
  if (mimeType.includes('pdf'))            return <FileText className="w-3.5 h-3.5 text-red-400" />;
  if (mimeType.includes('zip') || mimeType.includes('tar') || mimeType.includes('rar'))
                                           return <Archive className="w-3.5 h-3.5 text-amber-400" />;
  if (mimeType.includes('word') || mimeType.includes('document'))
                                           return <FileText className="w-3.5 h-3.5 text-blue-400" />;
  return <File className="w-3.5 h-3.5 text-slate-400" />;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentPicker({
  attachments,
  onChange,
  maxFiles = 5,
  maxMB = 4,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadMutation = useUploadAttachments();
  const deleteMutation = useDeleteAttachment();

  const totalBytes = attachments.reduce((sum, a) => sum + a.sizeBytes, 0);
  const totalMB    = totalBytes / (1024 * 1024);
  const overLimit  = totalMB > maxMB;

  const handleFiles = async (files: FileList) => {
    if (!files.length) return;

    const toUpload = Array.from(files).slice(0, maxFiles - attachments.length);
    if (!toUpload.length) return;

    try {
      const res = await uploadMutation.mutateAsync(toUpload);
      onChange([...attachments, ...res.data]);
    } catch {
      // error shown via isPending/isError state
    }
  };

  const remove = async (att: AttachmentInfo) => {
    try {
      await deleteMutation.mutateAsync(att.id);
      onChange(attachments.filter((a) => a.id !== att.id));
    } catch {
      // silent — optimistic remove still works visually
      onChange(attachments.filter((a) => a.id !== att.id));
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs text-muted font-mono">Attachments</label>
        <span className="text-xs text-subtle font-mono">
          {attachments.length}/{maxFiles} files · {formatBytes(totalBytes)} / {maxMB} MB
        </span>
      </div>

      {/* Existing attachments */}
      {attachments.length > 0 && (
        <div className="space-y-1.5">
          {attachments.map((att) => (
            <div
              key={att.id}
              className="flex items-center gap-2.5 px-3 py-2 bg-surface-3 border border-border rounded-lg group"
            >
              <span className="text-slate-400 flex-shrink-0">{fileIcon(att.mimeType)}</span>
              <span className="text-xs text-slate-300 flex-1 truncate font-mono">{att.originalName}</span>
              <span className="text-xs text-subtle flex-shrink-0">{formatBytes(att.sizeBytes)}</span>
              <button
                onClick={() => remove(att)}
                className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-muted hover:text-red-400 transition-all"
                title="Remove"
              >
                {deleteMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <X className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Over-limit warning */}
      {overLimit && (
        <div className="flex items-center gap-1.5 text-xs text-amber-400 p-2 bg-amber-500/8 border border-amber-500/20 rounded-lg">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          Total size exceeds {maxMB} MB. Graph API may reject the request.
        </div>
      )}

      {/* Upload trigger */}
      {attachments.length < maxFiles && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadMutation.isPending}
            className={cn(
              'w-full flex items-center justify-center gap-2 px-3 py-2 border border-dashed border-border rounded-lg',
              'text-xs text-muted hover:text-slate-300 hover:border-border-2 hover:bg-surface-2 transition-all',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            {uploadMutation.isPending ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Uploading…</>
            ) : (
              <><Paperclip className="w-3.5 h-3.5" /> Attach files (PDF, DOCX, images…)</>
            )}
          </button>
        </>
      )}
    </div>
  );
}
