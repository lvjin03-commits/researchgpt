export type AttachmentStorageMetadata = {
  bucket: string;
  path: string;
  fileName: string;
  fileType: string;
  fileSize: number;
};

export type AttachmentInput = {
  name: string;
  type: string;
  buffer: Buffer;
};
