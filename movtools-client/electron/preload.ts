/**
 * Electron 预加载脚本
 * 
 * 在渲染进程和主进程之间建立安全的桥接，
 * 通过 contextBridge 暴露有限的 API 给前端。
 * 前端通过 window.movtools 对象调用这些 API。
 */
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  EnvironmentStatus,
  AppSettings,
  DialogPickFileOptions,
  SavePastedImageRequest,
  CancelTaskRequest,
  BatchImportLensRequest,
  BatchDeleteLensRequest,
  BatchUpdateLensStatusRequest,
  BatchUpdateLensVersionTagRequest,
  BindLensFileRequest,
  CreateEpisodeRequest,
  CreateLensRequest,
  CreateProjectRequest,
  CreateTaskRequest,
  CreateTaskResponse,
  DeleteProjectRequest,
  DeleteLensRequest,
  ExecuteExtractRequest,
  ExtractActionResponse,
  ExtractHistoryResponse,
  ExtractPreviewResponse,
  FileCheckConfigRequest,
  FileCheckProgressEvent,
  ExtractProgressEvent,
  FileCheckMutationResponse,
  FileCheckStatePayload,
  GenerateExtractPreviewRequest,
  EpisodeListResponse,
  EpisodeMutationResponse,
  ExportLensIssueReportRequest,
  ExportLensIssueReportResponse,
  ManualDocument,
  MediaTask,
  LensListResponse,
  LensMutationResponse,
  MovtoolsApi,
  OpenProjectRequest,
  CommitVersionUploadRequest,
  PrepareVersionUploadRequest,
  ProjectMutationResponse,
  ProjectWorkspace,
  ResolveWorkbenchSourceMetadataRequest,
  ResolveWorkbenchSourceMetadataResponse,
  SetActiveEpisodeRequest,
  UpdateReworkRecordRequest,
  UpdateLensRequest,
  UpdateLensStatusRequest,
  SetActiveProjectRequest,
  TaskLogAppendedEvent,
  TaskLogsResponse,
  TaskUpdatedEvent,
  UpdateSettingsRequest,
  AppInfo,
  ApplyProjectInitializationRequest,
  PrepareProjectInitializationRequest,
  PrepareProjectInitializationResponse,
  WorkbenchLensSourcesResponse,
} from '../src/types/ipc';

const api: MovtoolsApi = {
  app: {
    getInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app:getInfo'),
  },
  project: {
    list: (): Promise<ProjectWorkspace> => ipcRenderer.invoke('project:list'),
    create: (request: CreateProjectRequest): Promise<ProjectMutationResponse> => ipcRenderer.invoke('project:create', request),
    prepareInitialization: (request: PrepareProjectInitializationRequest): Promise<PrepareProjectInitializationResponse> => ipcRenderer.invoke('project:prepareInitialization', request),
    applyInitialization: (request: ApplyProjectInitializationRequest) => ipcRenderer.invoke('project:applyInitialization', request),
    open: (request: OpenProjectRequest): Promise<ProjectMutationResponse> => ipcRenderer.invoke('project:open', request),
    listEpisodes: (projectId?: string): Promise<EpisodeListResponse> => ipcRenderer.invoke('project:listEpisodes', projectId),
    createEpisode: (request: CreateEpisodeRequest): Promise<EpisodeMutationResponse> => ipcRenderer.invoke('project:createEpisode', request),
    setActive: (request: SetActiveProjectRequest): Promise<ProjectMutationResponse> => ipcRenderer.invoke('project:setActive', request),
    setActiveEpisode: (request: SetActiveEpisodeRequest): Promise<EpisodeMutationResponse> => ipcRenderer.invoke('project:setActiveEpisode', request),
    delete: (request: DeleteProjectRequest): Promise<ProjectMutationResponse> => ipcRenderer.invoke('project:delete', request),
  },
  fileCheck: {
    getState: (): Promise<FileCheckStatePayload> => ipcRenderer.invoke('fileCheck:getState'),
    updateConfig: (request: FileCheckConfigRequest): Promise<FileCheckMutationResponse> => ipcRenderer.invoke('fileCheck:updateConfig', request),
    scan: (): Promise<FileCheckMutationResponse> => ipcRenderer.invoke('fileCheck:scan'),
    scanLayout: (): Promise<FileCheckMutationResponse> => ipcRenderer.invoke('fileCheck:scanLayout'),
    scanLens: (request) => ipcRenderer.invoke('fileCheck:scanLens', request),
    refreshLensBindings: (request) => ipcRenderer.invoke('fileCheck:refreshLensBindings', request),
    scanLayoutReferences: () => ipcRenderer.invoke('fileCheck:scanLayoutReferences'),
    scanLensLayoutReferences: (request) => ipcRenderer.invoke('fileCheck:scanLensLayoutReferences', request),
    exportLayoutReferences: (request) => ipcRenderer.invoke('fileCheck:exportLayoutReferences', request),
    bindFile: (request: BindLensFileRequest): Promise<FileCheckMutationResponse> => ipcRenderer.invoke('fileCheck:bindFile', request),
    openBoundFile: (fileId: string): Promise<FileCheckMutationResponse> => ipcRenderer.invoke('fileCheck:openBoundFile', fileId),
    selectLayoutCandidate: (request) => ipcRenderer.invoke('fileCheck:selectLayoutCandidate', request),
    addLayoutCandidate: (request) => ipcRenderer.invoke('fileCheck:addLayoutCandidate', request),
    addLayoutVideoBinding: (request) => ipcRenderer.invoke('fileCheck:addLayoutVideoBinding', request),
    onProgress: (listener: (event: FileCheckProgressEvent) => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, payload: FileCheckProgressEvent) => listener(payload);
      ipcRenderer.on('fileCheck:progress', wrapped);
      return () => {
        ipcRenderer.removeListener('fileCheck:progress', wrapped);
      };
    },
  },
  extract: {
    preview: (request: GenerateExtractPreviewRequest): Promise<ExtractPreviewResponse> => ipcRenderer.invoke('extract:preview', request),
    execute: (request: ExecuteExtractRequest): Promise<ExtractActionResponse> => ipcRenderer.invoke('extract:execute', request),
    history: (): Promise<ExtractHistoryResponse> => ipcRenderer.invoke('extract:history'),
    openTarget: (targetPath: string): Promise<ExtractActionResponse> => ipcRenderer.invoke('extract:openTarget', targetPath),
    onProgress: (listener: (event: ExtractProgressEvent) => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, payload: ExtractProgressEvent) => listener(payload);
      ipcRenderer.on('extract:progress', wrapped);
      return () => {
        ipcRenderer.removeListener('extract:progress', wrapped);
      };
    },
  },
  lens: {
    list: (): Promise<LensListResponse> => ipcRenderer.invoke('lens:list'),
    workbenchSources: (): Promise<WorkbenchLensSourcesResponse> => ipcRenderer.invoke('lens:workbenchSources'),
    resolveWorkbenchSourceMetadata: (request: ResolveWorkbenchSourceMetadataRequest): Promise<ResolveWorkbenchSourceMetadataResponse> => ipcRenderer.invoke('lens:resolveWorkbenchSourceMetadata', request),
    detail: (request) => ipcRenderer.invoke('lens:detail', request),
    resolveLocalPreview: (request) => ipcRenderer.invoke('lens:resolveLocalPreview', request),
    create: (request: CreateLensRequest): Promise<LensMutationResponse> => ipcRenderer.invoke('lens:create', request),
    update: (request: UpdateLensRequest): Promise<LensMutationResponse> => ipcRenderer.invoke('lens:update', request),
    updateStatus: (request: UpdateLensStatusRequest): Promise<LensMutationResponse> => ipcRenderer.invoke('lens:updateStatus', request),
    updateInternalReviewStatus: (request) => ipcRenderer.invoke('lens:updateInternalReviewStatus', request),
    updateReworkRecord: (request: UpdateReworkRecordRequest): Promise<LensMutationResponse> => ipcRenderer.invoke('lens:updateReworkRecord', request),
    batchUpdateStatus: (request: BatchUpdateLensStatusRequest): Promise<LensMutationResponse> => ipcRenderer.invoke('lens:batchUpdateStatus', request),
    batchUpdateVersionTag: (request: BatchUpdateLensVersionTagRequest): Promise<LensMutationResponse> => ipcRenderer.invoke('lens:batchUpdateVersionTag', request),
    delete: (request: DeleteLensRequest): Promise<LensMutationResponse> => ipcRenderer.invoke('lens:delete', request),
    batchDelete: (request: BatchDeleteLensRequest): Promise<LensMutationResponse> => ipcRenderer.invoke('lens:batchDelete', request),
    import: (request: BatchImportLensRequest): Promise<LensMutationResponse> => ipcRenderer.invoke('lens:import', request),
    exportIssues: (request: ExportLensIssueReportRequest): Promise<ExportLensIssueReportResponse> => ipcRenderer.invoke('lens:exportIssues', request),
    prepareVersionUpload: (request: PrepareVersionUploadRequest) => ipcRenderer.invoke('lens:prepareVersionUpload', request),
    commitVersionUpload: (request: CommitVersionUploadRequest) => ipcRenderer.invoke('lens:commitVersionUpload', request),
  },
  task: {
    create: (request: CreateTaskRequest): Promise<CreateTaskResponse> => ipcRenderer.invoke('task:create', request),
    list: (): Promise<MediaTask[]> => ipcRenderer.invoke('task:list'),
    cancel: (request: CancelTaskRequest) => ipcRenderer.invoke('task:cancel', request),
    retry: (request) => ipcRenderer.invoke('task:retry', request),
    remove: (request) => ipcRenderer.invoke('task:remove', request),
    clearCompleted: () => ipcRenderer.invoke('task:clearCompleted'),
    openLog: (request) => ipcRenderer.invoke('task:openLog', request),
    exportLog: (request) => ipcRenderer.invoke('task:exportLog', request),
    listLogs: (): Promise<TaskLogsResponse> => ipcRenderer.invoke('task:listLogs'),
    onUpdated: (listener: (event: TaskUpdatedEvent) => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, payload: TaskUpdatedEvent) => listener(payload);

      ipcRenderer.on('task:updated', wrapped);

      return () => {
        ipcRenderer.removeListener('task:updated', wrapped);
      };
    },
    onLogAppended: (listener: (event: TaskLogAppendedEvent) => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, payload: TaskLogAppendedEvent) => listener(payload);

      ipcRenderer.on('task:logAppended', wrapped);

      return () => {
        ipcRenderer.removeListener('task:logAppended', wrapped);
      };
    },
  },
  dialog: {
    pickFile: (options?: DialogPickFileOptions): Promise<string | null> => ipcRenderer.invoke('dialog:pickFile', options),
    pickFiles: (options?: DialogPickFileOptions): Promise<string[]> => ipcRenderer.invoke('dialog:pickFiles', options),
    getDroppedFilePaths: (files: File[]): string[] => files
      .map((file) => webUtils.getPathForFile(file))
      .filter((filePath) => Boolean(filePath)),
    savePastedImage: (request: SavePastedImageRequest): Promise<string> => ipcRenderer.invoke('dialog:savePastedImage', request),
    saveAnnotationImage: (request) => ipcRenderer.invoke('dialog:saveAnnotationImage', request),
    pickDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickDirectory'),
    openManual: (manual: ManualDocument) => ipcRenderer.invoke('dialog:openManual', manual),
    openPath: (filePath: string) => ipcRenderer.invoke('dialog:openPath', filePath),
  },
  file: {
    exists: (request) => ipcRenderer.invoke('file:exists', request),
    readBase64: (request) => ipcRenderer.invoke('file:readBase64', request),
  },
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
    update: (request: UpdateSettingsRequest): Promise<AppSettings> => ipcRenderer.invoke('settings:update', request),
    validate: (request: UpdateSettingsRequest) => ipcRenderer.invoke('settings:validate', request),
    status: (): Promise<EnvironmentStatus> => ipcRenderer.invoke('settings:status'),
    clearPreviewCache: () => ipcRenderer.invoke('settings:clearPreviewCache'),
  },
};

contextBridge.exposeInMainWorld('movtools', api);
