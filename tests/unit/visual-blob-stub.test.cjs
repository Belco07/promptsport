const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {startVisualBlobStub}=require('../fixtures/visual-blob-stub.cjs');

test('export : le vrai SDK Blob transmet les octets PNG à la fixture HTTP locale',async()=>{
  const previousToken=process.env.BLOB_READ_WRITE_TOKEN,previousApi=process.env.VERCEL_BLOB_API_URL;
  process.env.BLOB_READ_WRITE_TOKEN='vercel_blob_rw_e2efixture_00000000000000000000000000000000';
  let stop=()=>{};
  try {
    stop=await startVisualBlobStub();
    const {put}=await import('@vercel/blob');
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
    const result=await put('uploads/fixture.png',png,{access:'public',contentType:'image/png',addRandomSuffix:false});
    assert.match(result.url,/^\/uploads\/e2e-visual-blob-[a-f0-9-]+\.png$/);
    assert.deepEqual(fs.readFileSync(path.join(process.cwd(),'public',result.url.slice(1))),png);
  } finally {
    stop();
    if(previousToken===undefined)delete process.env.BLOB_READ_WRITE_TOKEN;else process.env.BLOB_READ_WRITE_TOKEN=previousToken;
    if(previousApi===undefined)delete process.env.VERCEL_BLOB_API_URL;else process.env.VERCEL_BLOB_API_URL=previousApi;
  }
});
