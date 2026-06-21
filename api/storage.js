// api/storage.js
// 단어장/문장함/세션/마지막탭 데이터를 Supabase에 저장하고 불러온다.
// 클라이언트는 항상 이 API만 호출하고, Supabase 키는 서버에만 있다.

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

function getClient() {
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase 환경변수가 설정되어 있지 않습니다.');
  }
  return createClient(supabaseUrl, supabaseKey);
}

const ALLOWED_KEYS = new Set(['session:write', 'session:interpret', 'words:all', 'sentences:all', 'meta:lastTab']);

export default async function handler(req, res) {
  let supabase;
  try {
    supabase = getClient();
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }

  if (req.method === 'GET') {
    const { key } = req.query;
    if (!key || !ALLOWED_KEYS.has(key)) {
      return res.status(400).json({ error: '유효하지 않은 key입니다.' });
    }
    const { data, error } = await supabase
      .from('kv_store')
      .select('value')
      .eq('key', key)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ value: data ? data.value : null });
  }

  if (req.method === 'POST') {
    const { key, value } = req.body || {};
    if (!key || !ALLOWED_KEYS.has(key)) {
      return res.status(400).json({ error: '유효하지 않은 key입니다.' });
    }
    const { error } = await supabase
      .from('kv_store')
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const { key } = req.query;
    if (!key || !ALLOWED_KEYS.has(key)) {
      return res.status(400).json({ error: '유효하지 않은 key입니다.' });
    }
    const { error } = await supabase.from('kv_store').delete().eq('key', key);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: '지원하지 않는 메서드입니다.' });
}
