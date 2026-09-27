/**
 * 以 SQL 字串為 key 快取 prepared statement。
 *
 * node:sqlite 每次 `prepare()` 都要重新解析與編譯 SQL；事件熱路徑（每個 hook
 * 事件、每筆本機 token 紀錄）重複編譯同一段固定 SQL 是純浪費。SQL 字串都是
 * 原始碼內的有限常數集合，快取不會無限成長。
 */
export class StatementCache<Statement> {
  private readonly statements = new Map<string, Statement>()
  private readonly prepare: (sql: string) => Statement

  // 不用 parameter property：測試以 Node strip-types 直接執行，不支援該語法。
  constructor(prepare: (sql: string) => Statement) {
    this.prepare = prepare
  }

  get(sql: string): Statement {
    let statement = this.statements.get(sql)
    if (!statement) {
      statement = this.prepare(sql)
      this.statements.set(sql, statement)
    }
    return statement
  }

  clear(): void {
    this.statements.clear()
  }
}
