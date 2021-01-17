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
  sdpSemantics: 'unified-plan'
};

let peerConnection = null;
let localStream = null;
let remoteStream = null;
let roomDialog = null;
let roomId = null;
let localTransceiver = null;
let remoteTransceiver = null;
let isNegoDone = true;

function init() {
  document.querySelector('#cameraBtn').addEventListener('click', openUserMedia);
  document.querySelector('#hangupBtn').addEventListener('click', hangUp);
  document.querySelector('#createBtn').addEventListener('click', createRoom);
  document.querySelector('#joinBtn').addEventListener('click', joinRoom);
  document.querySelector('#sendrecvBtn').addEventListener('click', sendRecv);
  document.querySelector('#sendonlyBtn').addEventListener('click', sendOnly);
  document.querySelector('#recvonlyBtn').addEventListener('click', recvOnly);
  roomDialog = new mdc.dialog.MDCDialog(document.querySelector('#room-dialog'));
}
 
async function createRoom() {
  document.querySelector('#createBtn').disabled = true;
  document.querySelector('#joinBtn').disabled = true;
  const db = firebase.firestore();
  const roomRef = await db.collection('rooms').doc();

  console.log('Create PeerConnection with configuration: ', configuration);
  peerConnection = new RTCPeerConnection(configuration);
  console.log('-1');
  enableDirectionButton();
  registerPeerConnectionListeners(roomRef.id);

  console.log('0');

  // console.log('0');
  // peerConnection.addTransceiver(localStream.getVideoTracks()[0]);
  // console.log('1');
  localStream.getTracks().forEach(track => {
    console.log('1');
    peerConnection.addTrack(track, localStream);
    // peerConnection.addTransceiver(track, localStream);
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

  // Code for creating a room below
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  console.log('Created offer:', offer);

  // localTransceiver = peerConnection.addTransceiver(localStream.getVideoTracks()[0]);
  // console.log('localTransceiver : ', localTransceiver);
  // localTransceiver.receiver.track.onmute = () => console.log("transceiver.receiver.track.onmute");
  // localTransceiver.receiver.track.onended = () => console.log("transceiver.receiver.track.onended");
  // localTransceiver.receiver.track.onunmute = () => console.log("transceiver.receiver.track.onunmute");

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
    console.log('Got remote track:', event);
    
    // remoteStream.addTrack(event.transceiver.receiver.track);
    // console.log('Add a track to the remoteStream:', event.transceiver.receiver.track);
    event.streams[0].getTracks().forEach(track => {
      console.log('Add a track to the remoteStream:', track);
      
      remoteStream.addTrack(track);
    });

    event.streams[0].onaddtrack = () => {
      console.log('stream.onaddtrack, transceiver : ', event.transceiver);
    }
    event.streams[0].onremovetrack = () => console.log("stream.onremovetrack");
    event.transceiver.receiver.track.onmute = () => {
      console.log('transceiver.receiver.track.onmute, transceiver : ', event.transceiver);
    }
    event.transceiver.receiver.track.onended = () => console.log("transceiver.receiver.track.onended");
    event.transceiver.receiver.track.onunmute = () => {
      console.log("onunmute, transceiver.receiver.track.onunmute");
    };
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

function sendRecv() {
  peerConnection.getTransceivers().forEach(t=>{
    console.log('sendrecv tramsceiver : ', t);
    t.direction='sendrecv';
  });
}
function sendOnly() {
  peerConnection.getTransceivers().forEach(t=>{
    console.log('sendonly tramsceiver : ', t);
    t.direction='sendonly';
  });
}
function recvOnly() {
  peerConnection.getTransceivers().forEach(t=>{
    console.log('recvonly tramsceiver : ', t);
    t.direction='recvonly';
  });
}

async function joinRoomById(roomId) {
  const db = firebase.firestore();
  const roomRef = db.collection('rooms').doc(`${roomId}`);
  const roomSnapshot = await roomRef.get();
  console.log('Got room:', roomSnapshot.exists);

  if (roomSnapshot.exists) {
    console.log('Create PeerConnection with configuration: ', configuration);
    peerConnection = new RTCPeerConnection(configuration);
    registerPeerConnectionListeners(roomId);
    enableDirectionButton();
    
    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });
    // console.log('0');
    // peerConnection.addTransceiver(localStream.getVideoTracks()[0]);
    // console.log('1');

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
      console.log('Got remote track:', event);
      // remoteStream.addTrack(event.transceiver.receiver.track);
      // console.log('Add a track to the remoteStream:', event.transceiver.receiver.track);
      event.streams[0].getTracks().forEach(track => {
        console.log('Add a track to the remoteStream:', track);
        remoteStream.addTrack(track);
      });

      event.streams[0].onaddtrack = () => {
        console.log('stream.onaddtrack, transceiver : ', event.transceiver);
      }
      event.streams[0].onremovetrack = () => console.log("stream.onremovetrack");
      event.transceiver.receiver.track.onmute = () => {
        console.log('transceiver.receiver.track.onmute, transceiver : ', event.transceiver);
      }
      event.transceiver.receiver.track.onended = () => console.log("transceiver.receiver.track.onended");
      event.transceiver.receiver.track.onunmute = () => {
        console.log("onunmute, transceiver.receiver.track.onunmute");
      };
    });

    // Code for creating SDP answer below
    const offer = roomSnapshot.data().offer;
    console.log('Got offer:', offer);
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    console.log('Created answer:', answer);
    await peerConnection.setLocalDescription(answer);

    // localTransceiver = peerConnection.addTransceiver(localStream.getVideoTracks()[0]);
    // console.log('localTransceiver : ', localTransceiver);
    // localTransceiver.receiver.track.onmute = () => console.log("transceiver.receiver.track.onmute");
    // localTransceiver.receiver.track.onended = () => console.log("transceiver.receiver.track.onended");
    // localTransceiver.receiver.track.onunmute = () => console.log("transceiver.receiver.track.onunmute");

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
  const stream = await navigator.mediaDevices.getUserMedia({video: true});
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
  document.querySelector('#sendrecvBtn').disabled = true;
  document.querySelector('#sendonlyBtn').disabled = true;
  document.querySelector('#recvonlyBtn').disabled = true;
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

  // document.location.reload();
}

function enableDirectionButton() {
  document.querySelector('#sendrecvBtn').disabled = false;
  document.querySelector('#sendonlyBtn').disabled = false;
  document.querySelector('#recvonlyBtn').disabled = false;
}

function registerPeerConnectionListeners(roomId) {
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

  peerConnection.addEventListener('iceconnectionstatechange', () => {
    console.log(
        `ICE connection state change: ${peerConnection.iceConnectionState}`);
  });

  const db = firebase.firestore();
  const roomRef = db.collection('rooms').doc(`${roomId}`);

  peerConnection.addEventListener('negotiationneeded', async (e) => {
    if(!peerConnection.currentRemoteDescription) {
      return;
    }
    isNegoDone = false
    console.log('Peerconnection negotiationneeded event: ', e);
    const offer = await peerConnection.createOffer()
    await peerConnection.setLocalDescription(offer);
    const roomWithOffer = {
      'offerNego': {
        type: offer.type,
        sdp: offer.sdp,
      },
    };

    await roomRef.update(roomWithOffer);
    const unsubscribe = roomRef.onSnapshot(async snapshot => {
      const data = snapshot.data();
      if (data && data.answerNego) {
        console.log('Got remote negoation description: ', data.answerNego);
        const rtcSessionDescription = new RTCSessionDescription(data.answerNego);
        await peerConnection.setRemoteDescription(rtcSessionDescription);
        unsubscribe();
        isNegoDone = true;
      }
    });
  });
  roomRef.onSnapshot(async snapshot => {
    if (!isNegoDone && snapshot.data() && snapshot.data().offerNego) {
      isNegoDone = false;
      const offer = snapshot.data().offerNego;
      console.log('Got nego offer:', offer);
      await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await peerConnection.createAnswer();
      console.log('Created nego answer:', answer);
      await peerConnection.setLocalDescription(answer);
      const roomWithAnswer = {
        answerNego: {
          type: answer.type,
          sdp: answer.sdp,
        },
      };
      roomRef.update(roomWithAnswer);
      setTimeout(()=>{isNegoDone = true}, 500);
    }
  });
}

init();
