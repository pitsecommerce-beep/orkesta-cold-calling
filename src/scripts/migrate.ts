import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

async function migrate() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
    process.exit(1);
  }

  const supabase = createClient(url, key);
  const migrationsDir = join(__dirname, '..', '..', 'supabase', 'migrations');

  const files = readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  console.log(`Found ${files.length} migration(s)`);

  for (const file of files) {
    console.log(`Running: ${file}`);
    const sql = readFileSync(join(migrationsDir, file), 'utf-8');

    const { error } = await supabase.rpc('exec_sql', { sql_query: sql });
    if (error) {
      console.error(`Migration ${file} failed:`, error.message);
      console.log('You may need to run this SQL directly in the Supabase SQL Editor.');
    } else {
      console.log(`  OK: ${file}`);
    }
  }

  console.log('Migrations complete');
}

migrate().catch(console.error);
