/**
 * 项目数据库服务
 * 
 * 负责 SQLite 数据库的初始化、表结构创建和数据迁移。
 * 使用同步 API（DatabaseSync）以简化主进程操作。
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/** 项目数据库初始化参数 */
export interface ProjectDatabaseBootstrap {
  projectId: string;
  projectName: string;
  projectRootPath: string;
  lensFolderRootPath?: string;
  layoutCheckPath?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * 初始化项目数据库
 * 创建必要的表结构并执行数据迁移
 * @param databasePath 数据库文件路径
 * @param payload 初始化参数
 */
export async function initializeProjectDatabase(databasePath: string, payload: ProjectDatabaseBootstrap): Promise<void> {
  await mkdir(path.dirname(databasePath), { recursive: true });

  const database = new DatabaseSync(databasePath);

  try {
    database.exec(`
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS project (
        project_id TEXT PRIMARY KEY NOT NULL,
        project_name TEXT NOT NULL,
        project_root_path TEXT NOT NULL,
        lens_folder_root_path TEXT,
        ma_check_path TEXT,
        mov_check_path TEXT,
        layout_check_path TEXT,
        create_time TEXT NOT NULL,
        update_time TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS lens (
        lens_id TEXT PRIMARY KEY NOT NULL,
        episode_id TEXT,
        lens_code TEXT NOT NULL,
        scene_no INTEGER,
        lens_name TEXT,
        single_frame INTEGER NOT NULL,
        frame_source_locked INTEGER NOT NULL DEFAULT 1,
        maker TEXT,
        note TEXT,
        lens_status TEXT NOT NULL,
        version_tag TEXT,
        version_num TEXT,
        file_name TEXT,
        update_time TEXT NOT NULL,
        UNIQUE(episode_id, lens_code)
      );

      CREATE TABLE IF NOT EXISTS lens_file (
        file_id TEXT PRIMARY KEY NOT NULL,
        episode_id TEXT,
        lens_code TEXT NOT NULL,
        version_num TEXT NOT NULL,
        file_type TEXT NOT NULL,
        file_relative_path TEXT NOT NULL,
        source_root TEXT,
        bind_time TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS lens_lifecycle (
        event_id TEXT PRIMARY KEY NOT NULL,
        lens_id TEXT NOT NULL,
        episode_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT,
        from_status TEXT,
        to_status TEXT,
        version_num TEXT NOT NULL,
        file_name TEXT NOT NULL,
        event_time TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS lens_lifecycle_attachment (
        attachment_id TEXT PRIMARY KEY NOT NULL,
        event_id TEXT NOT NULL,
        file_relative_path TEXT NOT NULL,
        file_name TEXT NOT NULL,
        create_time TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS episode (
        episode_id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        episode_code TEXT NOT NULL,
        episode_name TEXT NOT NULL,
        lens_folder_root_path TEXT,
        layout_check_path TEXT,
        version_tag TEXT,
        layout_tag TEXT,
        init_excel_path TEXT,
        create_time TEXT NOT NULL,
        update_time TEXT NOT NULL,
        UNIQUE(project_id, episode_code)
      );

      CREATE TABLE IF NOT EXISTS file_check (
        check_id TEXT PRIMARY KEY NOT NULL,
        episode_id TEXT,
        lens_code TEXT NOT NULL,
        ma_status TEXT NOT NULL,
        mov_status TEXT NOT NULL,
        layout_status TEXT,
        layout_candidate_count INTEGER DEFAULT 0,
        file_overall_status TEXT NOT NULL,
        last_check_time TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS lens_layout_candidate (
        candidate_id TEXT PRIMARY KEY NOT NULL,
        episode_id TEXT NOT NULL,
        lens_code TEXT NOT NULL,
        file_relative_path TEXT NOT NULL,
        file_name TEXT NOT NULL,
        source_root TEXT,
        source TEXT NOT NULL,
        is_selected INTEGER NOT NULL DEFAULT 0,
        bind_time TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS lens_layout_video_binding (
        binding_id TEXT PRIMARY KEY NOT NULL,
        episode_id TEXT NOT NULL,
        lens_code TEXT NOT NULL,
        candidate_id TEXT,
        file_relative_path TEXT NOT NULL,
        file_name TEXT NOT NULL,
        source_root TEXT,
        bind_time TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS layout_reference_check (
        check_id TEXT PRIMARY KEY NOT NULL,
        episode_id TEXT NOT NULL,
        lens_code TEXT NOT NULL,
        candidate_id TEXT NOT NULL,
        layout_file_path TEXT NOT NULL,
        status TEXT NOT NULL,
        issue_count INTEGER NOT NULL DEFAULT 0,
        path_missing_count INTEGER NOT NULL DEFAULT 0,
        file_missing_count INTEGER NOT NULL DEFAULT 0,
        filename_mismatch_count INTEGER NOT NULL DEFAULT 0,
        checked_reference_count INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        last_check_time TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS layout_reference_issue (
        issue_id TEXT PRIMARY KEY NOT NULL,
        check_id TEXT NOT NULL,
        issue_type TEXT NOT NULL,
        ref_original_path TEXT NOT NULL,
        ref_absolute_path TEXT NOT NULL,
        ref_directory TEXT NOT NULL,
        expected_file_name TEXT NOT NULL,
        core_basename TEXT NOT NULL,
        related_files_same_dir TEXT,
        related_files_parent_dirs TEXT
      );

      CREATE TABLE IF NOT EXISTS operate_log (
        log_id TEXT PRIMARY KEY NOT NULL,
        lens_code TEXT,
        operate_type TEXT NOT NULL,
        old_content TEXT,
        new_content TEXT,
        operate_time TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS extract_record (
        record_id TEXT PRIMARY KEY NOT NULL,
        extract_time TEXT NOT NULL,
        file_total INTEGER NOT NULL,
        ma_file_num INTEGER NOT NULL,
        mov_file_num INTEGER NOT NULL,
        target_path TEXT NOT NULL,
        is_success TEXT NOT NULL,
        fail_reason TEXT
      );

      CREATE TABLE IF NOT EXISTS scan_root (
        root_id TEXT PRIMARY KEY NOT NULL,
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        file_kind TEXT NOT NULL,
        root_label TEXT NOT NULL,
        root_path TEXT NOT NULL,
        init_excel_path TEXT,
        priority INTEGER NOT NULL DEFAULT 100,
        is_enabled INTEGER NOT NULL DEFAULT 1,
        create_time TEXT NOT NULL,
        update_time TEXT NOT NULL
      );
    `);

    // 迁移：给已有 lens 表补新增列（向后兼容旧项目）
    try {
      database.exec(`ALTER TABLE project ADD COLUMN lens_folder_root_path TEXT;`);
    } catch {
      // 列可能已存在，忽略
    }
    try {
      database.exec(`ALTER TABLE lens ADD COLUMN episode_id TEXT;`);
    } catch {
      // 列可能已存在，忽略
    }
    try {
      database.exec(`ALTER TABLE lens ADD COLUMN scene_no INTEGER;`);
    } catch {
      // 列可能已存在，忽略
    }
    try {
      database.exec(`ALTER TABLE lens ADD COLUMN lens_name TEXT;`);
    } catch {
      // 列可能已存在，忽略
    }
    try {
      database.exec(`ALTER TABLE lens ADD COLUMN version_tag TEXT;`);
    } catch {
      // 列可能已存在，忽略
    }
    try {
      database.exec(`ALTER TABLE lens ADD COLUMN frame_source_locked INTEGER NOT NULL DEFAULT 1;`);
    } catch {
      // 列可能已存在，忽略
    }
    database.exec(`
      UPDATE lens
      SET frame_source_locked = CASE
        WHEN single_frame <= 0 THEN 0
        ELSE COALESCE(frame_source_locked, 1)
      END
      WHERE frame_source_locked IS NULL OR single_frame <= 0 OR frame_source_locked = 1;
    `);
    try {
      database.exec(`ALTER TABLE lens ADD COLUMN note TEXT;`);
    } catch {
      // 列可能已存在，忽略
    }
    try {
      database.exec(`ALTER TABLE lens_file ADD COLUMN episode_id TEXT;`);
    } catch {
      // 列可能已存在，忽略
    }
    try {
      database.exec(`ALTER TABLE lens_file ADD COLUMN source_root TEXT;`);
    } catch {
      // 列可能已存在，忽略
    }
    try {
      database.exec(`ALTER TABLE file_check ADD COLUMN episode_id TEXT;`);
    } catch {
      // 列可能已存在，忽略
    }
    try {
      database.exec(`ALTER TABLE project ADD COLUMN layout_check_path TEXT;`);
    } catch {
      // 列可能已存在，忽略
    }
    try {
      database.exec(`ALTER TABLE file_check ADD COLUMN layout_status TEXT;`);
    } catch {
      // 列可能已存在，忽略
    }
    try {
      database.exec(`ALTER TABLE file_check ADD COLUMN layout_candidate_count INTEGER DEFAULT 0;`);
    } catch {
      // 列可能已存在，忽略
    }
    try {
      database.exec(`ALTER TABLE episode ADD COLUMN layout_check_path TEXT;`);
    } catch {
      // 列可能已存在，忽略
    }
    try {
      database.exec(`ALTER TABLE episode ADD COLUMN version_tag TEXT;`);
    } catch {
      // 列可能已存在，忽略
    }
    try {
      database.exec(`ALTER TABLE episode ADD COLUMN layout_tag TEXT;`);
    } catch {
      // 列可能已存在，忽略
    }
    database.exec(`
      CREATE TABLE IF NOT EXISTS lens_layout_video_binding (
        binding_id TEXT PRIMARY KEY NOT NULL,
        episode_id TEXT NOT NULL,
        lens_code TEXT NOT NULL,
        candidate_id TEXT,
        file_relative_path TEXT NOT NULL,
        file_name TEXT NOT NULL,
        source_root TEXT,
        bind_time TEXT NOT NULL
      );
    `);
    try {
      database.exec(`ALTER TABLE lens_layout_candidate ADD COLUMN source_root TEXT;`);
    } catch {
      // 列可能已存在，忽略
    }
    try {
      database.exec(`ALTER TABLE lens_layout_video_binding ADD COLUMN source_root TEXT;`);
    } catch {
      // 列可能已存在，忽略
    }
    try {
      database.exec(`ALTER TABLE scan_root ADD COLUMN init_excel_path TEXT;`);
    } catch {
      // 列可能已存在，忽略
    }
    database.exec(`
      CREATE TABLE IF NOT EXISTS lens_lifecycle_attachment (
        attachment_id TEXT PRIMARY KEY NOT NULL,
        event_id TEXT NOT NULL,
        file_relative_path TEXT NOT NULL,
        file_name TEXT NOT NULL,
        create_time TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0
      );
    `);

    migrateLensTableToEpisodeScoped(database);
    migrateLayoutVideoBindingTable(database);

    database.prepare(`
      INSERT INTO project (
        project_id,
        project_name,
        project_root_path,
        lens_folder_root_path,
        layout_check_path,
        create_time,
        update_time
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        project_name = excluded.project_name,
        project_root_path = excluded.project_root_path,
        lens_folder_root_path = excluded.lens_folder_root_path,
        layout_check_path = excluded.layout_check_path,
        update_time = excluded.update_time
    `).run(
      payload.projectId,
      payload.projectName,
      payload.projectRootPath,
      payload.lensFolderRootPath ?? null,
      payload.layoutCheckPath ?? null,
      payload.createdAt,
      payload.updatedAt,
    );
  } finally {
    database.close();
  }
}

function migrateLayoutVideoBindingTable(database: DatabaseSync): void {
  const columns = database.prepare(`PRAGMA table_info('lens_layout_video_binding')`).all() as Array<{ name: string; notnull: number }>;
  const candidateColumn = columns.find((column) => column.name === 'candidate_id');
  if (!candidateColumn || candidateColumn.notnull === 0) {
    return;
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS lens_layout_video_binding__migrated (
      binding_id TEXT PRIMARY KEY NOT NULL,
      episode_id TEXT NOT NULL,
      lens_code TEXT NOT NULL,
      candidate_id TEXT,
      file_relative_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      source_root TEXT,
      bind_time TEXT NOT NULL
    );

    INSERT INTO lens_layout_video_binding__migrated (binding_id, episode_id, lens_code, candidate_id, file_relative_path, file_name, source_root, bind_time)
    SELECT binding_id, episode_id, lens_code, candidate_id, file_relative_path, file_name, source_root, bind_time
    FROM lens_layout_video_binding;

    DROP TABLE lens_layout_video_binding;
    ALTER TABLE lens_layout_video_binding__migrated RENAME TO lens_layout_video_binding;
  `);
}

function migrateLensTableToEpisodeScoped(database: DatabaseSync): void {
  const indexes = database.prepare(`PRAGMA index_list('lens')`).all() as Array<{ name: string; unique: number; origin: string }>;
  const uniqueIndexes = indexes.filter((index) => index.unique === 1 && index.origin !== 'pk');
  const hasCompositeUnique = uniqueIndexes.some((index) => {
    const columns = database.prepare(`PRAGMA index_info('${index.name}')`).all() as Array<{ name: string }>;
    return columns.length === 2 && columns[0]?.name === 'episode_id' && columns[1]?.name === 'lens_code';
  });
  const hasLegacyLensCodeUnique = uniqueIndexes.some((index) => {
    const columns = database.prepare(`PRAGMA index_info('${index.name}')`).all() as Array<{ name: string }>;
    return columns.length === 1 && columns[0]?.name === 'lens_code';
  });

  if (hasCompositeUnique && !hasLegacyLensCodeUnique) {
    return;
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS lens__migrated (
      lens_id TEXT PRIMARY KEY NOT NULL,
      episode_id TEXT,
      lens_code TEXT NOT NULL,
      scene_no INTEGER,
      lens_name TEXT,
      single_frame INTEGER NOT NULL,
      frame_source_locked INTEGER NOT NULL DEFAULT 1,
      maker TEXT,
      note TEXT,
      lens_status TEXT NOT NULL,
      version_tag TEXT,
      version_num TEXT,
      file_name TEXT,
      update_time TEXT NOT NULL,
      UNIQUE(episode_id, lens_code)
    );

    INSERT INTO lens__migrated (lens_id, episode_id, lens_code, scene_no, lens_name, single_frame, frame_source_locked, maker, note, lens_status, version_tag, version_num, file_name, update_time)
    SELECT lens_id, episode_id, lens_code, scene_no, lens_name, single_frame, CASE WHEN single_frame <= 0 THEN 0 ELSE COALESCE(frame_source_locked, 1) END, maker, note, lens_status, version_tag, version_num, file_name, update_time
    FROM lens;

    DROP TABLE lens;
    ALTER TABLE lens__migrated RENAME TO lens;
  `);
}
