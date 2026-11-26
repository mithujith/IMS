import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { storage } from '../firebase';
import { Attachment, StoredDocument } from '../types';
import { createOrgDoc, generateId, softDeleteOrgDoc } from './firestoreList';
import { logActivity } from './activityService';

export async function uploadFileToStorage(
  orgId: string,
  folder: string,
  file: File
): Promise<{ url: string; storagePath: string }> {
  const maxBytes = 10 * 1024 * 1024;
  if (file.size > maxBytes) {
    throw new Error('File exceeds 10 MB limit.');
  }
  const isAllowed = file.type.startsWith('image/') || file.type === 'application/pdf';
  if (!isAllowed) {
    throw new Error('Only images and PDF documents under 10 MB are allowed.');
  }
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `organizations/${orgId}/${folder}/${Date.now()}_${safeName}`;
  const fileRef = ref(storage, storagePath);
  await uploadBytes(fileRef, file, { contentType: file.type });
  const url = await getDownloadURL(fileRef);
  return { url, storagePath };
}

export async function uploadAttachment(
  orgId: string,
  moduleFolder: string,
  userName: string,
  file: File
): Promise<Attachment> {
  const { url } = await uploadFileToStorage(orgId, `attachments/${moduleFolder}`, file);
  return {
    id: generateId(),
    name: file.name,
    url,
    size: file.size,
    contentType: file.type,
    uploadedAt: new Date().toISOString(),
    uploadedBy: userName,
  };
}

export async function uploadDocumentRecord(params: {
  orgId: string;
  userId: string;
  userName: string;
  folder: string;
  file: File;
  tags?: string[];
}): Promise<string> {
  const { url, storagePath } = await uploadFileToStorage(
    params.orgId,
    `documents/${params.folder.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
    params.file
  );

  const docId = await createOrgDoc(params.orgId, 'documents', params.userId, {
    name: params.file.name,
    folder: params.folder || 'General',
    url,
    storagePath,
    contentType: params.file.type,
    size: params.file.size,
    uploadedByName: params.userName,
    tags: params.tags ?? [],
  } satisfies Omit<StoredDocument, 'id' | 'organizationId' | 'createdBy' | 'createdAt' | 'updatedAt' | 'updatedBy'>);

  await logActivity({
    orgId: params.orgId,
    userId: params.userId,
    userName: params.userName,
    module: 'Documents',
    action: 'Uploaded Document',
    entityId: docId,
    entityName: params.file.name,
    details: `Folder: ${params.folder}`,
  });

  return docId;
}

export async function removeDocumentRecord(
  orgId: string,
  docId: string,
  storagePath: string,
  userId: string,
  userName: string,
  name: string
): Promise<void> {
  try {
    if (storagePath) {
      await deleteObject(ref(storage, storagePath));
    }
  } catch {
    // Ignore if already removed in Storage
  }
  await softDeleteOrgDoc(orgId, 'documents', docId, userId);
  await logActivity({
    orgId,
    userId,
    userName,
    module: 'Documents',
    action: 'Deleted Document',
    entityId: docId,
    entityName: name,
  });
}
