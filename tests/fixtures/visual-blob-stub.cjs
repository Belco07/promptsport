// Local HTTP stand-in for the external Blob API. No application behavior is bypassed.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {randomUUID} = require('node:crypto');

exports.startVisualBlobStub = async function startVisualBlobStub() {
  const root = path.join(process.cwd(), 'public', 'uploads');
  fs.mkdirSync(root, {recursive:true});
  const prefix = `e2e-visual-blob-${randomUUID()}`;
  // next start inventories public files at startup; reserve only this fixture's names.
  const names = Array.from({length:32}, (_,index)=>`${prefix}-${index}.png`);
  for(const name of names) fs.writeFileSync(path.join(root,name), Buffer.alloc(0));
  let index = 0;
  const server = http.createServer((req,res)=>{
    if(req.method !== 'PUT' || req.headers.authorization !== `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`) {res.writeHead(401);res.end();return;}
    const chunks=[];let size=0;
    req.on('data',chunk=>{size+=chunk.length;if(size>5*1024*1024){req.destroy();return;}chunks.push(chunk);});
    req.on('end',()=>{
      const name=names[index++];
      if(!name){res.writeHead(429);res.end();return;}
      const data=Buffer.concat(chunks);
      if(data.subarray(1,4).toString()!=='PNG'){res.writeHead(400);res.end();return;}
      fs.writeFileSync(path.join(root,name),data);
      const url=`/uploads/${name}`;
      res.writeHead(200,{'Content-Type':'application/json'});
      res.end(JSON.stringify({url,downloadUrl:url,pathname:`uploads/${name}`,contentType:'image/png',contentDisposition:`inline; filename="${name}"`,etag:`e2e-${index}`}));
    });
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const address=server.address();
  process.env.VERCEL_BLOB_API_URL=`http://127.0.0.1:${address.port}`;
  return ()=>{server.close();for(const name of names)try{fs.unlinkSync(path.join(root,name));}catch{/* Tests may already have removed their exports. */}};
};
