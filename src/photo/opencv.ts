// The one place that imports OpenCV.js; loadCv.ts imports this file dynamically, so OpenCV lands
// in its own chunk (assets/opencv-*.js). It exists because importing the package dynamically
// straight away hangs the app: the bundler copies the package's exports, including the Emscripten
// Module's `then`, onto the import's result, and the import promise then resolves itself forever.
// A static import here has no promise to resolve, and this file's own exports have no `then`.
import cv from '@techstark/opencv-js';

export default cv;
