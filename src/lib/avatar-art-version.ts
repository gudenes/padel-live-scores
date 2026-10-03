/** A private PNG travels with its renderer version, including storage/download copies. */
const signature = Buffer.from([137,80,78,71,13,10,26,10])
const marker = Buffer.from('padel-artwork\0a01-v1')
function crc32(bytes: Buffer) {
 let crc=0xffffffff
 for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}
 return (crc^0xffffffff)>>>0
}
export function markA01Avatar(bytes: Uint8Array): Buffer {
 const png=Buffer.from(bytes)
 if(!png.subarray(0,8).equals(signature)||png.length<33||png.toString('ascii',12,16)!=='IHDR')throw Error('Invalid avatar PNG')
 const chunk=Buffer.alloc(marker.length+12)
 chunk.writeUInt32BE(marker.length,0);chunk.write('tEXt',4);marker.copy(chunk,8)
 chunk.writeUInt32BE(crc32(chunk.subarray(4,-4)),chunk.length-4)
 return Buffer.concat([png.subarray(0,33),chunk,png.subarray(33)])
}
export function avatarArtVersion(bytes: Uint8Array): 'a01-v1'|'legacy' {
 const png=Buffer.from(bytes)
 if(!png.subarray(0,8).equals(signature))return 'legacy'
 for(let offset=8;offset+12<=png.length;){
  const length=png.readUInt32BE(offset),end=offset+length+12
  if(end>png.length)return 'legacy'
  if(png.toString('ascii',offset+4,offset+8)==='tEXt'&&png.subarray(offset+8,end-4).equals(marker)&&png.readUInt32BE(end-4)===crc32(png.subarray(offset+4,end-4)))return 'a01-v1'
  offset=end
 }
 return 'legacy'
}
