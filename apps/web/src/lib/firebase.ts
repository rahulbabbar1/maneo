import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

const firebaseConfig = {
  projectId: 'uk-self-assessment',
  appId: '1:1014225777564:web:9b87445ea4133f472e8e59',
  storageBucket: 'uk-self-assessment.firebasestorage.app',
  apiKey: 'AIzaSyB-MxQitK5g5-rY9JDWsvJj_DrkFTg7194',
  authDomain: 'uk-self-assessment.firebaseapp.com',
  messagingSenderId: '1014225777564',
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
