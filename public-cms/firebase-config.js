const firebaseConfig = {
  apiKey: 'AIzaSyBEUdu_TdTfRvpBpVzdVoHqfQAtrIXAAAw',
  authDomain: 'admin-panel-nkbkcoop-cbf10.firebaseapp.com',
  projectId: 'admin-panel-nkbkcoop-cbf10',
  storageBucket: 'admin-panel-nkbkcoop-cbf10.firebasestorage.app',
  messagingSenderId: '201514361144',
  appId: '1:201514361144:web:e81bf4b50fd782b39d61cd',
  measurementId: 'G-DFHZN01J6L'
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const db = firebase.firestore();
window.db = db;
