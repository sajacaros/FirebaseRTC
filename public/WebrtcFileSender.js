const chunkSize = 16384;

let fileReader;

const readSlice = (file, currentOffset) => {
  console.log('readSlice ', currentOffset);
  const slice = file.slice(currentOffset, currentOffset + chunkSize);
  fileReader.readAsArrayBuffer(slice);
};

const sendFile = (channel, file) => {
  return new Promise((resolve, reject) => {
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

let downloadInProgress = false;
let incomingFileInfo;

receiveFile = ({data}}) => {
  return new Promise((resolve, reject) => {
    if(downloadInProgress=== false) {
      incomingFileInfo = JSON.parse( data.toString() );
      console.log(`${incomingFileInfo.fileName} : ${incomingFileInfo.fileSize}`);
      downloadInProgress = true;
    } else {
      console.log(`Received Message ${data.byteLength}`);
      receiveBuffer.push(data);
      receivedSize += data.byteLength;

      receiveProgress.value = receivedSize;

      if (receivedSize === incomingFileInfo.fileSize) {
        const received = new Blob(receiveBuffer);
        receiveBuffer = [];

        resolve({fileName : incomingFileInfo.fileName, fileSize : incomingFileInfo.fileSize});

        fileRecvEnd();
      }
    });
  }
}

function fileRecvEnd() {
  console.log('complete to receive file, file : ', );

  downloadInProgress = false;
  receiveBuffer = [];
  receivedSize = 0;
}