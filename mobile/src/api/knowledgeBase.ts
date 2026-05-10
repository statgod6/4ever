import apiClient from './client'

export interface PersonaDocumentInfo {
  id: string; filename: string; fileSize: number; chunkCount: number; createdAt: string
}

export const knowledgeBaseApi = {
  uploadDocument: async (
    personaId: string,
    uri: string,
    filename: string,
    mimeType: string,
    onProgress?: (percent: number) => void,
  ): Promise<PersonaDocumentInfo> => {
    const formData = new FormData()
    formData.append('file', {
      uri,
      name: filename,
      type: mimeType,
    } as any)
    const response = await apiClient.post(
      `/knowledge-base/${personaId}/upload`,
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (progressEvent) => {
          if (onProgress && progressEvent.total) {
            const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total)
            onProgress(percent)
          }
        },
      },
    )
    return response.data
  },
  getDocuments: async (personaId: string): Promise<PersonaDocumentInfo[]> => {
    const response = await apiClient.get(`/knowledge-base/${personaId}/documents`)
    return response.data
  },
  deleteDocument: async (documentId: string): Promise<void> => {
    await apiClient.delete(`/knowledge-base/documents/${documentId}`)
  },
}
