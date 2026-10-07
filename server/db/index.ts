import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_DB_PATH = path.resolve(__dirname, '../../data/calendar.db');

const DB_PATH = process.env.DB_PATH ? path.resolve(process.cwd(), process.env.DB_PATH) : DEFAULT_DB_PATH;
const SCHEMA_PATH = path.resolve(__dirname, 'schema.sql');

// 确保数据目录存在
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

/**
 * 兼容 better-sqlite3 API 的 sql.js 封装
 * sql.js 是纯 JS/WASM 实现，无需原生编译
 * 
 * 关键区别：sql.js 的 prepared statement 是一次性的，
 * 每次 run/get/all 都需要重新 prepare，不能复用。
 */
class Database {
  private db: any = null;
  private dirty = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  async init() {
    const SQL = await initSqlJs();

    if (fs.existsSync(DB_PATH)) {
      const fileBuffer = fs.readFileSync(DB_PATH);
      this.db = new SQL.Database(fileBuffer);
    } else {
      this.db = new SQL.Database();
    }

    const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
    this.db.exec(schema);

    this.runMigrations();
    this.save();

    this.saveTimer = setInterval(() => this.save(), 5000);
  }

  private runMigrations() {
    try {
      const todoCols = this.db.exec("PRAGMA table_info(todos)");
      if (todoCols.length > 0) {
        const colNames = todoCols[0].values.map((row: any[]) => row[1]);
        if (!colNames.includes('color')) {
          this.db.exec("ALTER TABLE todos ADD COLUMN color TEXT");
          this.markDirty();
        }
      }

      const tableResult = this.db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'");
      if (tableResult.length === 0 || tableResult[0].values.length === 0) {
        this.db.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
        this.markDirty();
      }

      const todoCols2 = this.db.exec("PRAGMA table_info(todos)");
      if (todoCols2.length > 0) {
        const colNames2 = todoCols2[0].values.map((row: any[]) => row[1]);
        if (!colNames2.includes('completed_at')) {
          this.db.exec("ALTER TABLE todos ADD COLUMN completed_at DATETIME");
          this.markDirty();
        }
      }

      // 事件级颜色：课表导入按课程配色，老库补列
      const eventCols = this.db.exec("PRAGMA table_info(events)");
      if (eventCols.length > 0) {
        const eventColNames = eventCols[0].values.map((row: any[]) => row[1]);
        if (!eventColNames.includes('color')) {
          this.db.exec("ALTER TABLE events ADD COLUMN color TEXT");
          this.markDirty();
        }
      }

      // ---- 合并同步所需字段 ----
      // uid: 跨设备稳定标识。各端自增 id 空间不一致（本机是时间戳派生的大数字，
      //      服务端从 1 开始），按 id 对齐会张冠李戴，因此合并一律按 uid 匹配。
      // updated_at: 同一条 uid 内容不同时用它决胜（新的赢）。
      const syncTables = ['todos', 'calendars', 'events'];
      for (const tbl of syncTables) {
        const info = this.db.exec("PRAGMA table_info(" + tbl + ")");
        if (info.length === 0) continue;
        const cols = info[0].values.map((row: any[]) => row[1]);
        // events 表已有 uid 列（存 iCal 的 UID），语义不同不能复用，
        // 因此同步标识统一用 sync_uid 列名。
        if (!cols.includes('sync_uid')) {
          this.db.exec("ALTER TABLE " + tbl + " ADD COLUMN sync_uid TEXT");
          this.markDirty();
        }
        if (!cols.includes('updated_at')) {
          this.db.exec("ALTER TABLE " + tbl + " ADD COLUMN updated_at DATETIME");
          this.markDirty();
        }
      }

      // 历史数据补 uid，保证每条记录都能参与合并
      for (const tbl of syncTables) {
        const missing = this.db.exec("SELECT id FROM " + tbl + " WHERE sync_uid IS NULL OR sync_uid = ''");
        if (missing.length > 0) {
          const ids = missing[0].values.map((r: any[]) => r[0]);
          for (const id of ids) {
            const u = tbl + '-' + id + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
            this.db.exec("UPDATE " + tbl + " SET sync_uid = '" + u + "' WHERE id = " + id);
          }
          this.markDirty();
        }
      }

      // sync_uid 唯一索引：合并时靠它识别同一条数据
      for (const tbl of syncTables) {
        try {
          this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_" + tbl + "_sync_uid ON " + tbl + "(sync_uid)");
        } catch { /* 历史数据存在重复 uid 时跳过，不影响运行 */ }
      }
    } catch (err) {
      console.error('Migration error:', err);
    }
  }

  /**
   * 返回一个 Statement 对象，每次调用 run/get/all 都会
   * 重新 prepare SQL，以确保 sql.js statement 不会因复用而崩溃
   */
  prepare(sql: string): Statement {
    return new Statement(sql, this);
  }

  exec(sql: string) {
    this.db.exec(sql);
    this.markDirty();
  }

  pragma(pragmaStr: string) {
    try {
      this.db.exec(`PRAGMA ${pragmaStr}`);
    } catch {
      // 忽略不支持的 pragma
    }
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      this.markDirty();
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /** 内部：执行一条带参数的 SQL 并返回底层 statement（用完必须 free） */
  _prepareAndBind(sql: string, params: any[]): any {
    const stmt = this.db.prepare(sql);
    if (params.length > 0) {
      stmt.bind(params);
    }
    return stmt;
  }

  getLastInsertRowId(): number {
    const result = this.db.exec('SELECT last_insert_rowid() as id');
    if (result.length > 0 && result[0].values.length > 0) {
      return result[0].values[0][0] as number;
    }
    return 0;
  }

  getRowsModified(): number {
    return this.db.getRowsModified();
  }

  markDirty() {
    this.dirty = true;
  }

  save() {
    if (!this.db) return;
    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      const tmpPath = DB_PATH + '.tmp';
      fs.writeFileSync(tmpPath, buffer);
      fs.renameSync(tmpPath, DB_PATH);
      this.dirty = false;
    } catch (err) {
      console.error('保存数据库失败:', err);
    }
  }

  close() {
    if (this.saveTimer) clearInterval(this.saveTimer);
    this.save();
    if (this.db) this.db.close();
  }
}

/**
 * Statement 封装 — 每次调用 run/get/all 都会重新 prepare，
 * 以兼容 better-sqlite3 的可复用 statement 模式
 */
class Statement {
  private sql: string;
  private db: Database;

  constructor(sql: string, db: Database) {
    this.sql = sql;
    this.db = db;
  }

  run(...params: any[]) {
    const stmt = this.db._prepareAndBind(this.sql, params);
    stmt.step();
    stmt.free();
    this.db.markDirty();
    return {
      lastInsertRowid: this.db.getLastInsertRowId(),
      changes: this.db.getRowsModified(),
    };
  }

  get(...params: any[]): any {
    const stmt = this.db._prepareAndBind(this.sql, params);
    let result: any = undefined;
    if (stmt.step()) {
      result = stmt.getAsObject();
    }
    stmt.free();
    return result;
  }

  all(...params: any[]): any[] {
    const stmt = this.db._prepareAndBind(this.sql, params);
    const rows: any[] = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  }
}

const db = new Database();

// 使用异步初始化而非顶层 await，确保模块加载不会因 ESM/CJS 差异导致崩溃
// db.ready 在其他模块 import 此模块后等待即可
const ready = db.init();

export { ready };
export default db;
