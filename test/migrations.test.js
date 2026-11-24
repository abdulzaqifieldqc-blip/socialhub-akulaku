// Pemeriksaan statis file migration SQL (BUKAN eksekusi ke database).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
const dir = new URL("../database/migrations/", import.meta.url);
const sql = (f) => readFileSync(new URL(f, dir), "utf8");
const strip = (s) => s.replace(/--.*$/gm, "");

test("migration 008: tidak destruktif", () => {
  const s = strip(sql("008_function_privileges.sql"));
  assert.ok(!/\b(drop\s+(table|column|schema|function)|delete\s+from|truncate)\b/i.test(s));
});
test("migration 008: authenticated & service_role tetap EXECUTE, PUBLIC & anon dicabut, ada transaksi", () => {
  const s = strip(sql("008_function_privileges.sql")).toLowerCase();
  assert.match(s, /grant execute on function public\.is_active_admin\(\) to authenticated, service_role/);
  assert.match(s, /revoke execute on function public\.is_active_admin\(\) from public/);
  assert.match(s, /revoke execute on function public\.is_active_admin\(\) from anon/);
  assert.ok(s.includes("begin;") && s.includes("commit;"));
  assert.ok(s.indexOf("grant execute") < s.indexOf("revoke execute"), "GRANT harus sebelum REVOKE");
});
test("rollback 008 mengembalikan hak lama", () => {
  assert.match(strip(sql("008_rollback.sql")).toLowerCase(), /grant execute on function public\.is_active_admin\(\) to public, anon/);
});
test("semua migration SQL: begin/commit seimbang", () => {
  for (const f of readdirSync(dir).filter(x => x.endsWith(".sql"))) {
    const s = strip(sql(f)).toLowerCase();
    assert.equal((s.match(/\bbegin;/g) || []).length, (s.match(/\bcommit;/g) || []).length, f);
  }
});
