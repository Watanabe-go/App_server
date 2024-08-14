const admin = require('firebase-admin');
const { initializeApp } = require('firebase-admin/app');
const express = require("express");
require('dotenv').config();
var router = express.Router();
const axios = require('axios');

// Initialize Firebase
const firebaseServiceAccount = {
    "type": process.env.TYPE,
    "project_id": process.env.PROJECT_ID,
    "private_key_id": process.env.PRIVATE_KEY_ID,
    "private_key": process.env.PRIVATE_KEY,
    "client_email": process.env.CLIENT_EMAIL,
    "client_id": process.env.CLIENT_ID,
    "auth_uri": process.env.AUTH_URI,
    "token_uri": process.env.TOKEN_URI,
    "auth_provider_x509_cert_url": process.env.AUTH_PROVIDER_CERT_URL,
    "client_x509_cert_url": process.env.CLIENT_CERT_URL,
    "universe_domain": process.env.UNIVERSE_DOMAIN,
}

// const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
const serviceAccount = firebaseServiceAccount;
initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

//受け取った画像URLをもとに感情データ取得
async function imageAnalys(imageURL){
  const visionApiKey = process.env.VISION_API_KEY;
  const visionApiEndpoint = process.env.VISION_API_ENDPOINT;
  const visionApiUrl = `${visionApiEndpoint}?key=${visionApiKey}`;
  if (!visionApiKey) {
      console.log("Env 'VISION_API_KEY' must be set.");
      process.exit(1);
  }

  const options = {
      requests: [
        {
          image: {
            source: {
              imageUri: imageURL
            }
          },
          features: [
            {
              type: "FACE_DETECTION",
              maxResults: 1,
            },
          ],
        },
      ],
    };

    try {
      const result = await axios.post(visionApiUrl, options);
      if (result.data && result.data.responses) {
        const responses = result.data.responses;
        if(responses[0]["faceAnnotations"]){
          const emotionData = {
            "joyLikelihood": responses[0]["faceAnnotations"][0]["joyLikelihood"],
            "sorrowLikelihood": responses[0]["faceAnnotations"][0]["sorrowLikelihood"],
            "angerLikelihood": responses[0]["faceAnnotations"][0]["angerLikelihood"],
            "surpriseLikelihood": responses[0]["faceAnnotations"][0]["surpriseLikelihood"],
          }
          return emotionData;
        }else{
          return {
            "joyLikelihood": "検知できませんでした",
            "sorrowLikelihood": "検知できませんでした",
            "angerLikelihood": "検知できませんでした",
            "surpriseLikelihood": "検知できませんでした",
          }
        }
      }
    } catch (error) {
      console.error(error.response || error);
    }
}

async function speechToText(voiceURL){
  const voiceApiKey = process.env.VOICE_API_KEY;
  const voiceApiEndpoint = process.env.VOICE_API_ENDPOINT;
  const voiceApiUrl = `${voiceApiEndpoint}?key=${voiceApiKey}`;

  if (!voiceApiKey) {
    console.log("Env 'VISION_API_KEY' must be set.");
    process.exit(1);
  }

  const options = {
    config: {
      encoding: "LINEAR16",
      sampleRateHertz: 44100,
      languageCode: "ja-JP",
    },
    audio: {
      uri: voiceURL
    }
  }

  try{
    let resultText = "";
    const result = await axios.post(voiceApiUrl, options);
    if (result.data && result.data.results) {
      const responses = result.data.results;
      for(let i = 0; i < responses.length; i ++){
        if(i >= 1){
          resultText = resultText + "。\\n" + responses[i]["alternatives"][0]["transcript"];
        }else{
          resultText = responses[i]["alternatives"][0]["transcript"];
        }
      }
      resultText = resultText + "。\\n";
      return resultText;
    }else{
      return "データがありません"
    }
  } catch(error){
    console.error(error.response || error);
  }
}

// GS://形式に変換
function urlChangeGS(url){
  const deleteStartIndex = url.indexOf("/o/");
  const deleteEndIndex = url.indexOf("?");
  const text = url.slice(deleteStartIndex + 3, deleteEndIndex);
  const result = process.env.GS_URL + text.replace(/%2F/g, "/");
  return result;
}

async function setDiaryData(uid, emotionResult, imageURL, voiceURL, voiceText){
  try{
    const docRef = db.collection('Users').doc(uid).collection("Diary");
    await docRef.add({
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      emotionResult: emotionResult,
      imageURL: imageURL,
      voiceURL: voiceURL,
      voiceText: voiceText
    });
    return {"code":"0","Message":"Save is Done."}
  }catch(e){
    return {"code":"1","Message":`Error adding document: ${e}`};
  }
}

router.get("/", (req, res) => {
  res.send({ message: "サーバー動いてるよ"});
});

router.post("/diary", async function (req, res) {
  const imageURL = req.body.imageURL; //画像のURLもらう
  const voiceURL = req.body.voiceURL; //音声のURLもらう
  const uid = req.body.uid; //uidもらう

  if(imageURL.length > 0 && voiceURL.length > 0 && uid.length > 0){
    const emotionResult = await imageAnalys(urlChangeGS(imageURL)); // APIに画像のURLを渡し、結果をレスポンスで返却してます
    const voiceText = await speechToText(urlChangeGS(voiceURL)); //音声の文字起こし
    const statusMessage = await setDiaryData(uid, emotionResult, imageURL, voiceURL, voiceText);  // uid使ってFirestoreのサブコレクション(Diary)に保存
    res.send(statusMessage);
  }else{
    res.send({"message": `求められているパラメータが不足しています。 imageURL: ${imageURL}, voiceURL: ${voiceURL}, uid: ${uid}`});
  }
});

module.exports = router;