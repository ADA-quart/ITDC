import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.resolve(__dirname, '../../data/calendar.db');
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

    // 如果已存在数据库文件则加载
    if (fs.existsSync(DB_PATH)) {
      const fileBuffer = fs.readFileSync(DB_PATH);
      this.db = new SQL.Database(fileBuffer);
    } else {
      this.db = new SQL.Database();
    }

    // 执行建表语句
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
    this.db.exec(schema);
    this.save();

    // 定期自动保存
    this.saveTimer = setInterval(() => this.save(), 5000);
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
