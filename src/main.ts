import './styles.css';
import { Game } from './game';

const canvas = document.getElementById('scene');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('Missing #scene canvas');
}

const game = new Game(canvas);
game.start();

// Stop iOS from treating a double-tap on the controls as a page zoom.
document.addEventListener('gesturestart', (e) => e.preventDefault());
