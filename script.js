window.addEventListener('offline', () => {
    displayStatus('Offline mode');
});

// DOM Elements
const audioPlayer = document.getElementById('audioPlayer') || {};
const loopBtn = document.getElementById('loopBtn') || {};
const playStopButton = document.getElementById('playStopBtn') || {};
const statusContainer = document.getElementById('status');
const songListContainer = document.getElementById('songList');
const seekBar = document.getElementById('seekBar');
const randomBtn = document.getElementById('randomBtn');
const timeDisplay = document.getElementById('timeDisplay');
if (!songListContainer || !statusContainer) {
    console.error('Required DOM elements missing (#songList or #status)');
}

// App State
let songList = [];
let currentSongIndex = -1;
let currentSongName = null;
let database = null;
let isRandom = false;
let loopMode = 0; // 0 = no loop, 1 = loop song, 2 = loop playlist

// Utility: Update status messages in the UI
function displayStatus(message) {
    console.log(message);
    if (statusContainer) {
        statusContainer.insertAdjacentHTML('afterbegin', `<p>${message}</p>`);
    }
}

// Utility: Format time in seconds to MM:SS
function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${secs < 10 ? '0' + secs : secs}`;
}

// Utility: Update time display
function updateTimeDisplay() {
    if (audioPlayer.src) {
        const currentTime = formatTime(audioPlayer.currentTime);
        const duration = formatTime(audioPlayer.duration || 0);
        timeDisplay.textContent = `${currentTime} / ${duration}`;
    } else {
        timeDisplay.textContent = '0:00 / 0:00';
    }
}

// Initialize IndexedDB for song storage
async function initializeDatabase() {
    try {
        const request = indexedDB.open('MusicPlayerDB', 1);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            db.createObjectStore('songs', { keyPath: 'name' });
        };
        database = await new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(new Error(`IndexedDB failed: ${request.error}`));
        });
        displayStatus('Database ready');
    } catch (error) {
        displayStatus(`Error setting up storage: ${error.message} (falling back to temporary playback)`);
    }
}

// Songs: Save uploaded audio files to IndexedDB
async function saveFiles() {
    const fileInput = document.getElementById('audioFile');
    const files = fileInput.files;

    if (!files.length) {
        displayStatus('No audio files selected');
        return;
    }

    if (!database) {
        displayStatus('Storage unavailable; playing first file temporarily');
        playTemporaryFile(files[0]);
        return;
    }

    displayStatus('Saving files...');
    const transaction = database.transaction(['songs'], 'readwrite');
    const songStore = transaction.objectStore('songs');

    for (const file of files) {
        if (file.type.startsWith('audio/')) {
            songStore.put({ name: file.name, data: file });
            displayStatus(`Saved: ${file.name}`);
        } else {
            displayStatus(`Skipped ${file.name} (not an audio file)`);
        }
    }

    transaction.oncomplete = () => {
        refreshSongList();
        fileInput.value = '';
    };
}

// Temporary playback for when database isn’t available
function playTemporaryFile(file) {
    audioPlayer.src = URL.createObjectURL(file);
    togglePlayStop();
}

// Songs: Fetch and display all saved songs
async function refreshSongList() {
    if (!database) {
        displayStatus('Storage not initialized');
        return;
    }

    songListContainer.innerHTML = '';
    songList = [];

    const songs = await getAllSongs();
    songList = songs.map(song => song.name);
    songList.forEach((songName) => {
        const listItem = createSongListItem(songName);
        songListContainer.appendChild(listItem);
    });

    if (currentSongName && songList.includes(currentSongName)) {
        currentSongIndex = songList.indexOf(currentSongName);
    }

    displayStatus('Song list updated');
}

// Helper: Fetch all songs from IndexedDB
async function getAllSongs() {
    const transaction = database.transaction(['songs'], 'readonly');
    const songStore = transaction.objectStore('songs');
    const request = songStore.getAll();
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
            const error = new Error('Failed to fetch songs');
            console.error(error);
            reject(error);
        };
    });
}

// Helper: Create a song list item with play and remove buttons
function createSongListItem(songName) {
    const listItem = document.createElement('li');

    const playButton = document.createElement('button');
    playButton.textContent = songName;
    playButton.addEventListener('click', () => playSavedSong(songName));

    const removeButton = document.createElement('button');
    removeButton.textContent = '🗑️';
    removeButton.classList.add('removeBtn');
    removeButton.addEventListener('click', () => removeSong(songName));

    listItem.appendChild(playButton);
    listItem.appendChild(removeButton);
    return listItem;
}

// Playback: Load a saved song from IndexedDB and play it
async function playSavedSong(songName) {
    if (!database) return;

    const song = await getSongByName(songName);
    audioPlayer.pause();
    audioPlayer.src = URL.createObjectURL(song.data);
    audioPlayer.loop = (loopMode === 1); // Loop song only if mode is 1

    currentSongIndex = songList.indexOf(songName);
    currentSongName = songName;
    localStorage.setItem('currentSongName', songName);

    displayStatus(`Loaded: ${songName}`);
    togglePlayStop();

    audioPlayer.onloadedmetadata = () => {
        seekBar.max = audioPlayer.duration;
        seekBar.value = audioPlayer.currentTime;
        updateTimeDisplay();
    };
    audioPlayer.ontimeupdate = () => {
        seekBar.value = audioPlayer.currentTime;
        localStorage.setItem('currentTime', audioPlayer.currentTime);
        updateTimeDisplay();
    };
    audioPlayer.onended = () => {
        if (loopMode === 2) { // Loop playlist
            playNextSong();
        }
    };
}

// Helper: Fetch a song by name from IndexedDB
async function getSongByName(songName) {
    const transaction = database.transaction(['songs'], 'readonly');
    const songStore = transaction.objectStore('songs');
    const request = songStore.get(songName);
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
            const error = new Error(`Failed to load ${songName}`);
            console.error(error);
            reject(error);
        };
    });
}

// Playback: Toggle play or stop for the current song
function togglePlayStop() {
    if (audioPlayer.paused) {
        if (!audioPlayer.src && songList.length > 0) {
            playSavedSong(songList[0]);
        } else if (audioPlayer.src) {
            audioPlayer.play()
                .then(() => {
                    playStopButton.textContent = '⏹️';
                    playStopButton.setAttribute('aria-label', 'Stop');
                    displayStatus(`Playing: ${songList[currentSongIndex] || 'temporary file'}`);
                    updateSongState('playing');
                    document.title = songList[currentSongIndex] || 'FUS';
                    const playingButton = document.getElementById('playing');
                    if (playingButton) {
                        playingButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                })
                .catch(error => displayStatus(`Playback error: ${error.message}`));
        } else {
            displayStatus('No song loaded to play');
        }
    } else {
        audioPlayer.pause();
        playStopButton.textContent = '▶️';
        playStopButton.removeAttribute('aria-label');
        displayStatus('Paused');
        updateSongState('paused');
    }
}

// Playback: Jump to a specific time in the song
function seekToTime(value) {
    if (audioPlayer.src) {
        audioPlayer.currentTime = value;
        displayStatus(`Seek to ${Math.floor(value)}s`);
        updateTimeDisplay();
    }
}

// Playback: Play the previous song
function playPreviousSong() {
    if (songList.length === 0) return;
    currentSongIndex = (currentSongIndex - 1 + songList.length) % songList.length;
    playSavedSong(songList[currentSongIndex]);
}

// Playback: Play the next song
function playNextSong() {
    if (songList.length === 0) return;
    if (isRandom) {
        currentSongIndex = Math.floor(Math.random() * songList.length);
    } else {
        currentSongIndex = (currentSongIndex + 1) % songList.length;
    }
    playSavedSong(songList[currentSongIndex]);
}

// Playback: Toggle random playback
function toggleRandom() {
    isRandom = !isRandom;
    randomBtn.textContent = isRandom ? '🔀' : '➡️';
    randomBtn.classList.toggle('active', isRandom);
    displayStatus(`Random playback ${isRandom ? 'enabled' : 'disabled'}`);
    localStorage.setItem('randomEnabled', isRandom);

    setTimeout(() => randomBtn.blur(), 0);
}

// Playback: Load saved random state
function loadRandomState() {
    const randomEnabled = localStorage.getItem('randomEnabled');
    if (randomEnabled !== null) {
        isRandom = randomEnabled === 'true';
        randomBtn.textContent = isRandom ? '🔀' : '➡️';
        randomBtn.classList.toggle('active', isRandom);
        displayStatus(`Random playback ${isRandom ? 'enabled' : 'disabled'} (loaded from storage)`);
    }
}

// Loop: Toggle looping state (no loop, loop song, loop playlist)
function toggleLoop() {
    loopMode = (loopMode + 1) % 3;
    audioPlayer.loop = (loopMode === 1);
    if (loopMode === 0) loopBtn.textContent = '🔁';
    else if (loopMode === 1) loopBtn.textContent = '🔂';
    else loopBtn.textContent = '🔁';
    loopBtn.classList.toggle('active', loopMode !== 0);
    localStorage.setItem('loopMode', loopMode);
    displayStatus(`Loop mode: ${loopMode === 0 ? 'No loop' : loopMode === 1 ? 'Loop song' : 'Loop playlist'}`);

    setTimeout(() => loopBtn.blur(), 0);
}

// Loop: Load saved loop state
function loadLoopState() {
    const savedLoopMode = localStorage.getItem('loopMode');
    if (savedLoopMode !== null) {
        loopMode = parseInt(savedLoopMode, 10);
        audioPlayer.loop = (loopMode === 1);
        if (loopMode === 0) loopBtn.textContent = '🔁';
        else if (loopMode === 1) loopBtn.textContent = '🔂';
        else loopBtn.textContent = '🔁';
        loopBtn.classList.toggle('active', loopMode !== 0);
        displayStatus(`Loop mode: ${loopMode === 0 ? 'No loop' : loopMode === 1 ? 'Loop song' : 'Loop playlist'} (loaded from storage)`);
    }
}

// Songs: Remove a song from IndexedDB
async function removeSong(songName) {
    if (!database) {
        displayStatus('Storage not initialized');
        return;
    }

    const transaction = database.transaction(['songs'], 'readwrite');
    const songStore = transaction.objectStore('songs');
    songStore.delete(songName);

    transaction.oncomplete = () => {
        if (songList[currentSongIndex] === songName) {
            audioPlayer.pause();
            playStopButton.textContent = 'Play';
            currentSongIndex = -1;
            currentSongName = null;
            localStorage.removeItem('currentSongName');
            localStorage.removeItem('currentTime');
            updateTimeDisplay();
        }
        displayStatus(`Removed: ${songName}`);
        refreshSongList();
    };
}

// Playback: Load the last played song (with time restoration)
async function loadLastPlayedSong() {
    const savedSongName = localStorage.getItem('currentSongName');
    const savedTime = parseFloat(localStorage.getItem('currentTime')) || 0;
    if (savedSongName && songList.includes(savedSongName)) {
        currentSongName = savedSongName;
        currentSongIndex = songList.indexOf(savedSongName);
        const song = await getSongByName(savedSongName);
        audioPlayer.src = URL.createObjectURL(song.data);
        audioPlayer.loop = (loopMode === 1);
        audioPlayer.currentTime = savedTime;
        playStopButton.textContent = 'Play';
        displayStatus(`Loaded: ${savedSongName} at ${Math.floor(savedTime)}s (press Play)`);
        updateSongState('paused');
        audioPlayer.onloadedmetadata = () => {
            seekBar.max = audioPlayer.duration;
            seekBar.value = audioPlayer.currentTime;
            updateTimeDisplay();
        };
        audioPlayer.ontimeupdate = () => {
            seekBar.value = audioPlayer.currentTime;
            localStorage.setItem('currentTime', audioPlayer.currentTime);
            updateTimeDisplay();
        };
    } else {
        displayStatus('No valid song to resume or song list not yet loaded');
        playStopButton.textContent = 'Play';
    }
}

// UI: Update visual state of song buttons
function updateSongState(state) {
    const playButtons = document.querySelectorAll('#songList button:not(.removeBtn)');
    playButtons.forEach((button, index) => {
        if (button.id === 'playing' || button.id === 'paused') {
            button.id = '';
        }
        if (index === currentSongIndex) {
            button.id = state === 'playing' ? 'playing' : 'paused';
        }
    });
}

// App Initialization
window.onload = async () => {
    displayStatus('Starting app initialization');
    await initializeDatabase();
    displayStatus('Database setup complete');
    await refreshSongList();
    displayStatus('Song list loaded');
    loadLoopState();
    loadRandomState();
    displayStatus('Loop and random states loaded');
    await loadLastPlayedSong();
    displayStatus('App fully loaded');

    document.addEventListener('keydown', (event) => {
        if (event.code === 'Space') {
            event.preventDefault();
            togglePlayStop();
        }
    });
};