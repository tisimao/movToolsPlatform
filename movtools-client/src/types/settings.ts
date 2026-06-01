export interface AppSettings {
  serverBaseUrl: string;
  ffmpegPath: string;
  ffprobePath: string;
  defaultOutputDir: string;
  autoOpenOutputDir: boolean;
  logRetentionDays: number;
  renameDuringExtract: boolean;
}
