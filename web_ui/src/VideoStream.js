import React, { useEffect, useRef, useState } from 'react';
import io from "socket.io-client";
import {
  PoseLandmarker,
  FilesetResolver,
  DrawingUtils
} from "https://cdn.skypack.dev/@mediapipe/tasks-vision@0.10.0";

let poseLandmarker = undefined;
const createPoseLandmarker = async () => {
    const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
    );
    poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`,
        },
        runningMode: "VIDEO"
        
    });
};

// TODO move this flag into UI - here for easy testing right now
const USE_CLIENTSIDE_POSE_ESTIMATION = true;

// Bluetooth - TODO abstract this out so that we can select what actuator to use
const DEVICE_SERVICE_UUID = process.env.REACT_APP_DEVICE_SERVICE_UUID;
const DEVICE_CHARACTERISTIC_UUID = process.env.REACT_APP_DEVICE_CHARACTERISTIC_UUID;
const DEVICE_NAME = process.env.REACT_APP_DEVICE_NAME;


function VideoStream({ isOn = false }) {
  const localVideoRef = useRef();
  const socketRef = useRef();
  const [results, setResults] = useState(null);
  const [characteristic, setCharacteristic] = useState(null);
  const [bluetoothStatus, setBluetoothStatus] = useState("Bluetooth Device Not connected");

  useEffect(() => {
    if (isOn) {
        createPoseLandmarker();

        // Initialize the WebRTC connection
        async function initWebRTC() {
            const localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            if (localVideoRef.current) {
                localVideoRef.current.srcObject = localStream;
            }

            // Get the frame rate of the connected camera
            const videoTrack = localStream.getVideoTracks()[0];
            const settings = videoTrack.getSettings();
            let frameRate = settings.frameRate;
            if (frameRate >= 30) {
                frameRate = 30;
            }

            // TODO remove this - experimenting with frame rate
            // frameRate = 1
            // Calculate the interval between frames in milliseconds
            // const frameInterval = 1000 / frameRate;

            // TODO this is a rate limit based on processing time in the backend
            // if this interval (in ms) is too low, the backend will not be able to keep up
            // and the socket connection will hang and reset
            const frameInterval = 250;

            // Set up an interval to send frames periodically
            let intervalId;
            if (USE_CLIENTSIDE_POSE_ESTIMATION) {
                intervalId = setInterval(async () => {
                    // send current time in console
                    console.log("Sending keypoints @", localVideoRef.current.currentTime)

                    sendKeypoints();
                }, frameInterval);
            } else {
                intervalId = setInterval(() => {
                    sendFrame();
                }, frameInterval);
        }


            // Clean up the interval when the component is unmounted
            return () => clearInterval(intervalId);
        }

        initWebRTC();

        // Set up the Socket.IO connection and event listeners
        socketRef.current = io.connect(process.env.REACT_APP_POSE_PARSER_API_ENDPOINT);
        socketRef.current.on("frame_result", (data) => {
            setResults(data);
            // Send signal to bluetooth - TODO move this to a separate function
            if (data["success"] === true && characteristic) {
                let encoder = new TextEncoder('utf-8');
                let value = encoder.encode('a');
                characteristic.writeValue(value)
                    .then(() => characteristic.readValue())
                    .then(value => {
                        let decoder = new TextDecoder('utf-8');
                        let response = decoder.decode(value);
                        console.log(response);
                        if (response === 'd') {
                            setBluetoothStatus("Successfully sent stimulation");
                        } else {
                            setBluetoothStatus(`No stimulation sent: ${response}`);
                        }
                    })
                    .catch(error => console.log(error));
            }
        });

        /**
         * Capture a frame from a video element and convert it to a base64 encoded string.
         *
         * @param {HTMLVideoElement} video - The video element to capture the frame from.
         * @returns {string} - The base64 encoded frame data.
         */
        function captureFrame(video) {
            const canvas = document.createElement("canvas");
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            return canvas.toDataURL("image/jpeg", 0.8);
        }

        /**
         * Capture a frame from a video element and extract keypoints.
         *
         * @param {HTMLVideoElement} video - The video element to capture the frame from.
         */
        let lastVideoTime = -1;
        let currentResults = {};
        function captureFrameKeypoints(video) {
            // Perform pose estimation on the captured frame
            const canvas = document.createElement("canvas");
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            if (canvas.height > 0 && canvas.width > 0) {
                let startTimeMs = performance.now(); 
                if (lastVideoTime !== video.currentTime) {
                    lastVideoTime = video.currentTime;
                    poseLandmarker.detectForVideo( video, startTimeMs, (results) => {
                        currentResults = results
                    })
                    
                }
            }
        }

        /**
         * Send a captured frame to the server via a Socket.IO event.
         */
        function sendFrame() {
            const video = document.getElementById("localVideo");
            if (video) {
                const frameData = captureFrame(video);
                socketRef.current.emit("frame", frameData);
            }
        }

        /**
         * Send frame keypoints generated client-side to the server via a Socket.IO event.
         */
        function sendKeypoints() {
            const video = document.getElementById("localVideo");
            if (video) {
                captureFrameKeypoints(video);
                socketRef.current.emit("keypoints", currentResults);
            }
        }


        // Clean up the Socket.IO connection when the component is unmounted
        return () => {
            socketRef.current.disconnect();
        };

    } else {
        if (socketRef.current !== undefined && socketRef.current !== null) {
            socketRef.current.disconnect();
        }
    }
  }, [isOn, characteristic]);


    const connectToDevice = () => {
        setBluetoothStatus("Searching for device...");
        navigator.bluetooth.requestDevice({
            filters: [{ name: DEVICE_NAME }],
            optionalServices: [DEVICE_SERVICE_UUID]
        })
            .then(device => {
                setBluetoothStatus("Connecting to device...");
                return device.gatt.connect();
            })
            .then(server => {
                setBluetoothStatus("Discovering service...");
                return server.getPrimaryService(DEVICE_SERVICE_UUID);
            })
            .then(service => {
                setBluetoothStatus("Discovering characteristic...");
                return service.getCharacteristic(DEVICE_CHARACTERISTIC_UUID);
            })
            .then(characteristic => {
                setBluetoothStatus("Device connected!");
                setCharacteristic(characteristic);
            })
            .catch(error => {
                console.log(error);
                setBluetoothStatus("Failed to connect: " + error.message);
            });
    };

    return (
        <div>
            <video id="localVideo" ref={localVideoRef} autoPlay muted></video>
            {isOn ? (
                <div className='container'>
                    <div className='column'>
                        <h2>Debug:</h2>
                        {results ? <pre>{JSON.stringify(results, null, 2)}</pre> : <p>Awaiting server response...</p>}
                    </div>
                    <div className='column'>
                        {results ? 
                            <div 
                                className='column bg' 
                                style={{
                                backgroundColor: results.classification === true ? 'green' : 'red'
                                }}>
                                { results.classification === true ? 'Sending Bluetooth Signal' : '' }
                                <p>Bluetooth Device Status: {bluetoothStatus}</p>
                            </div> 
                        : null}
                    </div>
                </div>
        ) : null }
            <button onClick={connectToDevice}>Connect to Bluetooth Device</button>
        </div>
    );
}
export default VideoStream;
