const chunkSize = 16384;

let fileReader;

const readSlice = (file, currentOffset) => {
  console.log('readSlice ', currentOffset);
  const slice = file.slice(currentOffset, currentOffset + chunkSize);
  fileReader.readAsArrayBuffer(slice);
};

const sendData = (channel, file) => {
  return new Promise(function(resolve, reject) {
    console.log(`File is ${[file.name, file.size, file.type, file.lastModified].join(' ')}`);

    if (file.size === 0) {
      reject('File is empty');
      return;
    }
    
    channel.send(JSON.stringify({
      fileName: file.name,
      fileSize: file.size
    }));
    
    fileReader = new FileReader();
    let offset = 0;
    fileReader.addEventListener('error', error => console.error('Error reading file:', error));
    fileReader.addEventListener('abort', event => console.log('File reading aborted:', event));
    fileReader.addEventListener('load', chunk => {
      console.log('FileRead.onload ', chunk);
      channel.send(chunk.target.result);
      offset += chunk.target.result.byteLength;
      if (offset < file.size) {
        readSlice(file, offset);
      } else {
        resolve();
      }
    });
    readSlice(file, 0);
  });
}

export default sendFile;