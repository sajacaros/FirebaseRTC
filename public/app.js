mdc.ripple.MDCRipple.attachTo(document.querySelector('.mdc-button'));

const configuration = {
  iceServers: [
    {
      urls: [
        'stun:stun1.l.google.com:19302',
        'stun:stun2.l.google.com:19302',
      ],
    },
  ],
  iceCandidatePoolSize: 10,
};

let peerConnection = null;
let localStream = null;
let remoteStream = null;
let roomDialog = null;
let roomId = null;

let sendChannel;
let receiveChannel;
let fileReader;
const bitrateDiv = document.querySelector('div#bitrate');
const fileInput = document.querySelector('input#fileInput');
const abortButton = document.querySelector('button#abortButton');
const downloadAnchor = document.querySelector('a#download');
const sendProgress = document.querySelector('progress#sendProgress');
const receiveProgress = document.querySelector('progress#receiveProgress');
const statusMessage = document.querySelector('span#status');
const sendFileButton = document.querySelector('button#sendFile');

let receiveBuffer = [];
let receivedSize = 0;

let bytesPrev = 0;
let timestampPrev = 0;
let timestampStart;
let statsInterval = null;
let bitrateMax = 0;

function init() {
  document.querySelector('#cameraBtn').addEventListener('click', openUserMedia);
  document.querySelector('#hangupBtn').addEventListener('click', hangUp);
  document.querySelector('#createBtn').addEventListener('click', createRoom);
  document.querySelector('#joinBtn').addEventListener('click', joinRoom);
  roomDialog = new mdc.dialog.MDCDialog(document.querySelector('#room-dialog'));
}

function preferCodec(codecs, mimeType) {
  let otherCodecs = [];
  let sortedCodecs = [];
  let count = codecs.length;

  codecs.forEach(codec => {
    if (codec.mimeType === mimeType) {
      sortedCodecs.push(codec);
    } else {
      otherCodecs.push(codec);
    }
  });

  return sortedCodecs.concat(otherCodecs);
}

function changeVideoCodec() {
  const transceivers = peerConnection.getTransceivers();

  transceivers.forEach(transceiver => {
    const kind = transceiver.sender.track.kind;
    let sendCodecs = RTCRtpSender.getCapabilities(kind).codecs;
    let recvCodecs = RTCRtpReceiver.getCapabilities(kind).codecs;

    if (kind === "audio") {
      sendCodecs = preferCodec('audio/opus');
      recvCodecs = preferCodec('audio/opus');
      transceiver.setCodecPreferences([...sendCodecs, ...recvCodecs]);
    }
  });

  // peerConnection.onnegotiationneeded();
}

async function createRoom() {
  document.querySelector('#createBtn').disabled = true;
  document.querySelector('#joinBtn').disabled = true;
  const db = firebase.firestore();
  const roomRef = await db.collection('rooms').doc();

  console.log('Create PeerConnection with configuration: ', configuration);
  peerConnection = new RTCPeerConnection(configuration);

  registerPeerConnectionListeners();

  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });

  // Code for collecting ICE candidates below
  const callerCandidatesCollection = roomRef.collection('callerCandidates');

  peerConnection.addEventListener('icecandidate', event => {
    if (!event.candidate) {
      console.log('Got final candidate!');
      return;
    }
    console.log('Got candidate: ', event.candidate);
    callerCandidatesCollection.add(event.candidate.toJSON());
  });
  // Code for collecting ICE candidates above

  //datachannel create
  createConnection();

  peerConnection.onnegotiationneeded = (t, event)=> console.log(event);
  changeVideoCodec();
  
  // Code for creating a room below
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  console.log('Created offer:', offer);

  const roomWithOffer = {
    'offer': {
      type: offer.type,
      sdp: offer.sdp,
    },
  };
  await roomRef.set(roomWithOffer);
  roomId = roomRef.id;
  console.log(`New room created with SDP offer. Room ID: ${roomRef.id}`);
  document.querySelector(
      '#currentRoom').innerText = `Current room is ${roomRef.id} - You are the caller!`;
  // Code for creating a room above

  peerConnection.addEventListener('track', event => {
    console.log('Got remote track:', event.streams[0]);
    event.streams[0].getTracks().forEach(track => {
      console.log('Add a track to the remoteStream:', track);
      remoteStream.addTrack(track);
    });
  });

  // Listening for remote session description below
  roomRef.onSnapshot(async snapshot => {
    const data = snapshot.data();
    if (!peerConnection.currentRemoteDescription && data && data.answer) {
      console.log('Got remote description: ', data.answer);
      const rtcSessionDescription = new RTCSessionDescription(data.answer);
      await peerConnection.setRemoteDescription(rtcSessionDescription);
    }
  });
  // Listening for remote session description above

  // Listen for remote ICE candidates below
  roomRef.collection('calleeCandidates').onSnapshot(snapshot => {
    snapshot.docChanges().forEach(async change => {
      if (change.type === 'added') {
        let data = change.doc.data();
        console.log(`Got new remote ICE candidate: ${JSON.stringify(data)}`);
        await peerConnection.addIceCandidate(new RTCIceCandidate(data));
      }
    });
  });
  // Listen for remote ICE candidates above
}

function joinRoom() {
  document.querySelector('#createBtn').disabled = true;
  document.querySelector('#joinBtn').disabled = true;

  document.querySelector('#confirmJoinBtn').
      addEventListener('click', async () => {
        roomId = document.querySelector('#room-id').value;
        console.log('Join room: ', roomId);
        document.querySelector(
            '#currentRoom').innerText = `Current room is ${roomId} - You are the callee!`;
        await joinRoomById(roomId);
      }, {once: true});
  roomDialog.open();
}

async function joinRoomById(roomId) {
  const db = firebase.firestore();
  const roomRef = db.collection('rooms').doc(`${roomId}`);
  const roomSnapshot = await roomRef.get();
  console.log('Got room:', roomSnapshot.exists);

  if (roomSnapshot.exists) {
    console.log('Create PeerConnection with configuration: ', configuration);
    peerConnection = new RTCPeerConnection(configuration);
    registerPeerConnectionListeners();
    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });

    // Code for collecting ICE candidates below
    const calleeCandidatesCollection = roomRef.collection('calleeCandidates');
    peerConnection.addEventListener('icecandidate', event => {
      if (!event.candidate) {
        console.log('Got final candidate!');
        return;
      }
      console.log('Got candidate: ', event.candidate);
      calleeCandidatesCollection.add(event.candidate.toJSON());
    });
    // Code for collecting ICE candidates above

    peerConnection.addEventListener('track', event => {
      console.log('Got remote track:', event.streams[0]);
      event.streams[0].getTracks().forEach(track => {
        console.log('Add a track to the remoteStream:', track);
        remoteStream.addTrack(track);
      });
    });

    //datachannel create
    createConnection();

    // Code for creating SDP answer below
    const offer = roomSnapshot.data().offer;
    console.log('Got offer:', offer);
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    
    const answer = await peerConnection.createAnswer();
    console.log('Created answer:', answer);
    await peerConnection.setLocalDescription(answer);

    const roomWithAnswer = {
      answer: {
        type: answer.type,
        sdp: answer.sdp,
      },
    };
    await roomRef.update(roomWithAnswer);
    // Code for creating SDP answer above

    // Listening for remote ICE candidates below
    roomRef.collection('callerCandidates').onSnapshot(snapshot => {
      snapshot.docChanges().forEach(async change => {
        if (change.type === 'added') {
          let data = change.doc.data();
          console.log(`Got new remote ICE candidate: ${JSON.stringify(data)}`);
          await peerConnection.addIceCandidate(new RTCIceCandidate(data));
        }
      });
    });
    // Listening for remote ICE candidates above
  }
}

async function openUserMedia(e) {
  const stream = await navigator.mediaDevices.getUserMedia(
      {video: true, audio: true});
  document.querySelector('#localVideo').srcObject = stream;
  localStream = stream;
  remoteStream = new MediaStream();
  document.querySelector('#remoteVideo').srcObject = remoteStream;

  console.log('Stream:', document.querySelector('#localVideo').srcObject);
  document.querySelector('#cameraBtn').disabled = true;
  document.querySelector('#joinBtn').disabled = false;
  document.querySelector('#createBtn').disabled = false;
  document.querySelector('#hangupBtn').disabled = false;
}

async function hangUp(e) {
  const tracks = document.querySelector('#localVideo').srcObject.getTracks();
  tracks.forEach(track => {
    track.stop();
  });

  if (remoteStream) {
    remoteStream.getTracks().forEach(track => track.stop());
  }

  if (peerConnection) {
    peerConnection.close();
  }

  document.querySelector('#localVideo').srcObject = null;
  document.querySelector('#remoteVideo').srcObject = null;
  document.querySelector('#cameraBtn').disabled = false;
  document.querySelector('#joinBtn').disabled = true;
  document.querySelector('#createBtn').disabled = true;
  document.querySelector('#hangupBtn').disabled = true;
  document.querySelector('#currentRoom').innerText = '';

  // Delete room on hangup
  if (roomId) {
    const db = firebase.firestore();
    const roomRef = db.collection('rooms').doc(roomId);
    const calleeCandidates = await roomRef.collection('calleeCandidates').get();
    calleeCandidates.forEach(async candidate => {
      await candidate.ref.delete();
    });
    const callerCandidates = await roomRef.collection('callerCandidates').get();
    callerCandidates.forEach(async candidate => {
      await candidate.ref.delete();
    });
    await roomRef.delete();
  }

  document.location.reload();
}

function registerPeerConnectionListeners() {
  peerConnection.addEventListener('icegatheringstatechange', () => {
    console.log(
        `ICE gathering state changed: ${peerConnection.iceGatheringState}`);
  });

  peerConnection.addEventListener('connectionstatechange', () => {
    console.log(`Connection state change: ${peerConnection.connectionState}`);
  });

  peerConnection.addEventListener('signalingstatechange', () => {
    console.log(`Signaling state change: ${peerConnection.signalingState}`);
  });

  peerConnection.addEventListener('iceconnectionstatechange ', () => {
    console.log(
        `ICE connection state change: ${peerConnection.iceConnectionState}`);
  });

  peerConnection.addEventListener('datachannel', receiveChannelCallback);
}

init();

// file input change
fileInput.addEventListener('change', handleFileInputChange, false);
async function handleFileInputChange() {
  const file = fileInput.files[0];
  if (!file) {
    console.log('No file chosen');
  } else {
    sendFileButton.disabled = false;
  }
}
sendFileButton.addEventListener('click', () => sendData());
async function createConnection() {
  abortButton.disabled = false;
  sendFileButton.disabled = true;
  
  sendChannel = peerConnection.createDataChannel('sendDataChannel');
  // sendChannel.binaryType = 'arraybuffer';
  console.log('Created send data channel, ', sendChannel);

  sendChannel.addEventListener('open', onSendChannelStateChange);
  sendChannel.addEventListener('close', onSendChannelStateChange);
  sendChannel.addEventListener('error', error => console.error('Error in sendChannel:', error));
}

function onSendChannelStateChange() {
  const readyState = sendChannel.readyState;
  console.log(`Send channel state is: ${readyState}`);
}

function sendData() {
  fileInput.disabled = true;
  const file = fileInput.files[0];
  console.log(`File is ${[file.name, file.size, file.type, file.lastModified].join(' ')}`);

  // Handle 0 size files.
  statusMessage.textContent = '';
  downloadAnchor.textContent = '';
  if (file.size === 0) {
    bitrateDiv.innerHTML = '';
    statusMessage.textContent = 'File is empty, please select a non-empty file';
    initFileSend();
    return;
  }
  sendProgress.max = file.size;
  receiveProgress.max = file.size;
  sendChannel.send(JSON.stringify({
    fileName: file.name,
    fileSize: file.size
  }));
  const chunkSize = 16384;
  fileReader = new FileReader();
  let offset = 0;
  fileReader.addEventListener('error', error => console.error('Error reading file:', error));
  fileReader.addEventListener('abort', event => console.log('File reading aborted:', event));
  fileReader.addEventListener('load', e => {
    console.log('FileRead.onload ', e);
    sendChannel.send(e.target.result);
    offset += e.target.result.byteLength;
    sendProgress.value = offset;
    if (offset < file.size) {
      readSlice(offset);
    } else {
      initFileSend();
    }
  });
  const readSlice = o => {
    console.log('readSlice ', o);
    const slice = file.slice(offset, o + chunkSize);
    fileReader.readAsArrayBuffer(slice);
  };
  readSlice(0);
}

function receiveChannelCallback(event) {
  console.log('Receive Channel Callback');
  receiveChannel = event.channel;
  // receiveChannel.binaryType = 'arraybuffer';
  receiveChannel.onmessage = onReceiveMessageCallback;
  receiveChannel.onopen = onReceiveChannelStateChange;
  receiveChannel.onclose = onReceiveChannelStateChange;

  receivedSize = 0;
  bitrateMax = 0;
  downloadAnchor.textContent = '';
  downloadAnchor.removeAttribute('download');
  if (downloadAnchor.href) {
    URL.revokeObjectURL(downloadAnchor.href);
    downloadAnchor.removeAttribute('href');
  }
}

var downloadInProgress = false;
var incomingFileInfo;

function onReceiveMessageCallback(event) {
  if(downloadInProgress=== false) {
    incomingFileInfo = JSON.parse( event.data.toString() );
    console.log(`${incomingFileInfo.fileName} : ${incomingFileInfo.fileSize}`);
    downloadInProgress = true;
  } else {
    console.log(`Received Message ${event.data.byteLength}`);
    receiveBuffer.push(event.data);
    receivedSize += event.data.byteLength;

    receiveProgress.value = receivedSize;

    if (receivedSize === incomingFileInfo.fileSize) {
      const received = new Blob(receiveBuffer);
      receiveBuffer = [];

      downloadAnchor.href = URL.createObjectURL(received);
      downloadAnchor.download = incomingFileInfo.fileName;
      downloadAnchor.textContent =
        `Click to download '${incomingFileInfo.fileName}' (${incomingFileInfo.fileSize} bytes)`;
      downloadAnchor.style.display = 'block';

      const bitrate = Math.round(receivedSize * 8 /
        ((new Date()).getTime() - timestampStart));
      bitrateDiv.innerHTML =
        `<strong>Average Bitrate:</strong> ${bitrate} kbits/sec (max: ${bitrateMax} kbits/sec)`;

      if (statsInterval) {
        clearInterval(statsInterval);
        statsInterval = null;
      }

      initFileSend();
    }
  }
}

async function onReceiveChannelStateChange() {
  const readyState = receiveChannel.readyState;
  console.log(`Receive channel state is: ${readyState}`);
  console.log('peerconnection : ', peerConnection);
  if (readyState === 'open') {
    timestampStart = (new Date()).getTime();
    timestampPrev = timestampStart;
    statsInterval = setInterval(displayStats, 500);
    await displayStats();
  }
}

// display bitrate statistics.
async function displayStats() {
  if (peerConnection && peerConnection.iceConnectionState === 'connected') {
    const stats = await peerConnection.getStats();
    let activeCandidatePair;
    stats.forEach(report => {
      if (report.type === 'transport') {
        activeCandidatePair = stats.get(report.selectedCandidatePairId);
      }
    });
    if (activeCandidatePair) {
      if (timestampPrev === activeCandidatePair.timestamp) {
        return;
      }
      // calculate current bitrate
      const bytesNow = activeCandidatePair.bytesReceived;
      const bitrate = Math.round((bytesNow - bytesPrev) * 8 /
        (activeCandidatePair.timestamp - timestampPrev));
      bitrateDiv.innerHTML = `<strong>Current Bitrate:</strong> ${bitrate} kbits/sec`;
      timestampPrev = activeCandidatePair.timestamp;
      bytesPrev = bytesNow;
      if (bitrate > bitrateMax) {
        bitrateMax = bitrate;
      }
    }
  }
}

function initFileSend() {
  console.log('complete file send');

  // re-enable the file select
  fileInput.disabled = false;
  abortButton.disabled = true;
  sendFileButton.disabled = true;
  downloadInProgress = false;
  receiveBuffer = [];
  receivedSize = 0;

  bytesPrev = 0;
  timestampPrev = 0;
  statsInterval = null;
  bitrateMax = 0;
}

// function closeDataChannels() {
//   console.log('Closing data channels');
//   sendChannel.close();
//   console.log(`Closed data channel with label: ${sendChannel.label}`);
//   if (receiveChannel) {
//     receiveChannel.close();
//     console.log(`Closed data channel with label: ${receiveChannel.label}`);
//   }

//   // re-enable the file select
//   fileInput.disabled = false;
//   abortButton.disabled = true;
//   sendFileButton.disabled = false;
// }