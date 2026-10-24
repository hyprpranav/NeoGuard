/**
 * NeoGuard Demonstration Video Player Engine
 * Professional custom HTML5 video controller with zero-lag buffering,
 * -10s/+10s seeking, HD clarity enhancement filters, chapter navigation,
 * and keyboard shortcuts.
 */

document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('player-container');
  const video = document.getElementById('neoguard-video');
  if (!container || !video) return;

  // Controls Elements
  const centerPlay = document.getElementById('center-play-btn');
  const playBtn = document.getElementById('play-btn');
  const playIcon = document.getElementById('play-icon');
  const pauseIcon = document.getElementById('pause-icon');
  const skipBackBtn = document.getElementById('skip-back-btn');
  const skipFwdBtn = document.getElementById('skip-fwd-btn');
  const progressContainer = document.getElementById('progress-container');
  const progressPlayed = document.getElementById('progress-played');
  const progressBuffered = document.getElementById('progress-buffered');
  const progressThumb = document.getElementById('progress-thumb');
  const progressTooltip = document.getElementById('progress-tooltip');
  const currentTimeEl = document.getElementById('current-time');
  const durationEl = document.getElementById('duration');
  const volumeBtn = document.getElementById('volume-btn');
  const volumeSlider = document.getElementById('volume-slider');
  const volHighIcon = document.getElementById('vol-high-icon');
  const volMutedIcon = document.getElementById('vol-muted-icon');
  const speedBtn = document.getElementById('speed-btn');
  const speedMenu = document.getElementById('speed-menu');
  const speedOpts = document.querySelectorAll('.speed-opt');
  const enhanceBtn = document.getElementById('enhance-btn');
  const qualityBadge = document.getElementById('quality-badge');
  const pipBtn = document.getElementById('pip-btn');
  const fullscreenBtn = document.getElementById('fullscreen-btn');
  const fsExpandIcon = document.getElementById('fs-expand-icon');
  const fsCompressIcon = document.getElementById('fs-compress-icon');
  const feedbackEl = document.getElementById('player-feedback');
  const feedbackText = document.getElementById('feedback-text');
  const chapterBtns = document.querySelectorAll('.chapter-btn');

  let isScrubbing = false;
  let controlsTimeout = null;
  let enhancementMode = 'enhanced'; // 'enhanced', 'clinical', 'source'

  // Helper: Format Time in MM:SS
  function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  // Flash UI Feedback notification
  function showFeedback(text) {
    if (!feedbackEl || !feedbackText) return;
    feedbackText.textContent = text;
    feedbackEl.classList.add('show');
    clearTimeout(feedbackEl._timer);
    feedbackEl._timer = setTimeout(() => {
      feedbackEl.classList.remove('show');
    }, 700);
  }

  // Play / Pause Toggle
  function togglePlay() {
    if (video.paused || video.ended) {
      video.play().then(() => {
        container.classList.add('playing');
        updatePlayIcons(true);
        showFeedback('Playing');
      }).catch(err => {
        console.warn('Playback prevented:', err);
      });
    } else {
      video.pause();
      container.classList.remove('playing');
      updatePlayIcons(false);
      showFeedback('Paused');
    }
  }

  function updatePlayIcons(isPlaying) {
    if (playIcon) playIcon.style.display = isPlaying ? 'none' : 'block';
    if (pauseIcon) pauseIcon.style.display = isPlaying ? 'block' : 'none';
  }

  // Skip time (e.g. -10s, +10s)
  function skipTime(delta) {
    video.currentTime = Math.min(Math.max(video.currentTime + delta, 0), video.duration || 0);
    showFeedback(`${delta > 0 ? '+' : ''}${delta}s`);
    updateProgress();
  }

  // Progress update
  function updateProgress() {
    if (!video.duration) return;
    const current = video.currentTime;
    const duration = video.duration;
    const pct = (current / duration) * 100;

    if (progressPlayed) progressPlayed.style.width = `${pct}%`;
    if (progressThumb) progressThumb.style.left = `${pct}%`;
    if (currentTimeEl) currentTimeEl.textContent = formatTime(current);

    // Update buffered bar
    if (video.buffered.length > 0) {
      const bufferedEnd = video.buffered.end(video.buffered.length - 1);
      const bufferedPct = (bufferedEnd / duration) * 100;
      if (progressBuffered) progressBuffered.style.width = `${Math.min(bufferedPct, 100)}%`;
    }

    // Active Chapter Highlight
    updateActiveChapter(current);
  }

  // Chapter update based on current playback time
  function updateActiveChapter(curr) {
    chapterBtns.forEach(btn => {
      const start = parseFloat(btn.dataset.time || 0);
      const end = parseFloat(btn.dataset.end || 9999);
      if (curr >= start && curr < end) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  // Seek by mouse click/drag on progress bar
  function seekTo(e) {
    if (!video.duration || !progressContainer) return;
    const rect = progressContainer.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    video.currentTime = pos * video.duration;
    updateProgress();
  }

  // Volume & Mute
  function setVolume(val) {
    video.volume = Math.max(0, Math.min(1, val));
    video.muted = (video.volume === 0);
    if (volumeSlider) volumeSlider.value = video.volume;
    updateVolumeIcon();
  }

  function toggleMute() {
    video.muted = !video.muted;
    if (video.muted) {
      if (volumeSlider) volumeSlider.value = 0;
      showFeedback('Muted');
    } else {
      if (video.volume === 0) video.volume = 0.5;
      if (volumeSlider) volumeSlider.value = video.volume;
      showFeedback(`Volume ${Math.round(video.volume * 100)}%`);
    }
    updateVolumeIcon();
  }

  function updateVolumeIcon() {
    const isMuted = video.muted || video.volume === 0;
    if (volHighIcon) volHighIcon.style.display = isMuted ? 'none' : 'block';
    if (volMutedIcon) volMutedIcon.style.display = isMuted ? 'block' : 'none';
  }

  // Playback Rate
  function setPlaybackRate(rate) {
    video.playbackRate = rate;
    if (speedBtn) speedBtn.textContent = `${rate}x`;
    speedOpts.forEach(opt => {
      opt.classList.toggle('active', parseFloat(opt.dataset.speed) === rate);
    });
    if (speedMenu) speedMenu.classList.remove('open');
    showFeedback(`Speed ${rate}x`);
  }

  // Visual Enhancement Mode Switcher
  function toggleEnhancement() {
    if (enhancementMode === 'enhanced') {
      enhancementMode = 'clinical';
      video.className = 'video-element clinical-mode';
      if (enhanceBtn) {
        enhanceBtn.classList.add('active');
        enhanceBtn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2v20M2 12h20M4.93 4.93l14.14 14.14M4.93 19.07l14.14-14.14"/>
          </svg>
          Clinical Contrast
        `;
      }
      if (qualityBadge) qualityBadge.textContent = 'Clinical Contrast (1080p)';
      showFeedback('Clinical High-Contrast');
    } else if (enhancementMode === 'clinical') {
      enhancementMode = 'source';
      video.className = 'video-element';
      if (enhanceBtn) {
        enhanceBtn.classList.remove('active');
        enhanceBtn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
          Original Source
        `;
      }
      if (qualityBadge) qualityBadge.textContent = '1080p Source (Natural)';
      showFeedback('Original Source Stream');
    } else {
      enhancementMode = 'enhanced';
      video.className = 'video-element enhanced-mode';
      if (enhanceBtn) {
        enhanceBtn.classList.add('active');
        enhanceBtn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
          Enhanced Clarity
        `;
      }
      if (qualityBadge) qualityBadge.textContent = '1080p Ultra HD Enhanced';
      showFeedback('HD Clarity Filter On');
    }
  }

  // Fullscreen
  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      if (container.requestFullscreen) {
        container.requestFullscreen();
      } else if (container.webkitRequestFullscreen) {
        container.webkitRequestFullscreen();
      } else if (video.webkitEnterFullscreen) {
        video.webkitEnterFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
    }
  }

  function onFullscreenChange() {
    const isFs = !!document.fullscreenElement;
    container.classList.toggle('fullscreen', isFs);
    if (fsExpandIcon) fsExpandIcon.style.display = isFs ? 'none' : 'block';
    if (fsCompressIcon) fsCompressIcon.style.display = isFs ? 'block' : 'none';
  }

  // Picture-in-Picture
  async function togglePiP() {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled && video.requestPictureInPicture) {
        await video.requestPictureInPicture();
        showFeedback('Picture-in-Picture');
      }
    } catch (err) {
      console.warn('PiP failed:', err);
    }
  }

  // Auto-hide controls when mouse is inactive during playback
  function resetControlsTimer() {
    container.classList.remove('hide-controls');
    clearTimeout(controlsTimeout);
    if (!video.paused) {
      controlsTimeout = setTimeout(() => {
        container.classList.add('hide-controls');
      }, 2600);
    }
  }

  // Event Listeners
  video.addEventListener('click', togglePlay);
  if (centerPlay) centerPlay.addEventListener('click', togglePlay);
  if (playBtn) playBtn.addEventListener('click', togglePlay);
  if (skipBackBtn) skipBackBtn.addEventListener('click', () => skipTime(-10));
  if (skipFwdBtn) skipFwdBtn.addEventListener('click', () => skipTime(10));

  video.addEventListener('timeupdate', updateProgress);
  video.addEventListener('loadedmetadata', () => {
    if (durationEl) durationEl.textContent = formatTime(video.duration);
    updateProgress();
  });
  video.addEventListener('ended', () => {
    container.classList.remove('playing');
    updatePlayIcons(false);
  });
  video.addEventListener('play', () => {
    container.classList.add('playing');
    updatePlayIcons(true);
    resetControlsTimer();
  });
  video.addEventListener('pause', () => {
    container.classList.remove('playing');
    container.classList.remove('hide-controls');
    updatePlayIcons(false);
  });

  // Scrubber events
  if (progressContainer) {
    progressContainer.addEventListener('mousedown', (e) => {
      isScrubbing = true;
      seekTo(e);
    });

    window.addEventListener('mousemove', (e) => {
      if (isScrubbing) seekTo(e);
    });

    window.addEventListener('mouseup', () => {
      isScrubbing = false;
    });

    progressContainer.addEventListener('mousemove', (e) => {
      if (!video.duration || !progressTooltip) return;
      const rect = progressContainer.getBoundingClientRect();
      const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      progressTooltip.style.left = `${pos * 100}%`;
      progressTooltip.textContent = formatTime(pos * video.duration);
    });
  }

  // Volume Events
  if (volumeBtn) volumeBtn.addEventListener('click', toggleMute);
  if (volumeSlider) {
    volumeSlider.addEventListener('input', (e) => {
      setVolume(parseFloat(e.target.value));
    });
  }

  // Speed Events
  if (speedBtn) {
    speedBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      speedMenu.classList.toggle('open');
    });
  }

  speedOpts.forEach(opt => {
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      setPlaybackRate(parseFloat(opt.dataset.speed));
    });
  });

  document.addEventListener('click', () => {
    if (speedMenu) speedMenu.classList.remove('open');
  });

  // Enhancement Button
  if (enhanceBtn) enhanceBtn.addEventListener('click', toggleEnhancement);

  // Fullscreen & PiP
  if (fullscreenBtn) fullscreenBtn.addEventListener('click', toggleFullscreen);
  if (pipBtn) pipBtn.addEventListener('click', togglePiP);
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('webkitfullscreenchange', onFullscreenChange);

  // Inactive controls timer
  container.addEventListener('mousemove', resetControlsTimer);
  container.addEventListener('mouseleave', () => {
    if (!video.paused) container.classList.add('hide-controls');
  });

  // Chapters click handlers
  chapterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const time = parseFloat(btn.dataset.time || 0);
      video.currentTime = time;
      video.play().then(() => {
        container.classList.add('playing');
        updatePlayIcons(true);
      }).catch(() => {});
      showFeedback(`Jump: ${btn.querySelector('.chapter-title').textContent}`);
    });
  });

  // Keyboard Shortcuts
  document.addEventListener('keydown', (e) => {
    // Ignore when focus is inside an input/textarea
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

    switch (e.key) {
      case ' ':
      case 'k':
      case 'K':
        e.preventDefault();
        togglePlay();
        break;
      case 'ArrowLeft':
      case 'j':
      case 'J':
        e.preventDefault();
        skipTime(-10);
        break;
      case 'ArrowRight':
      case 'l':
      case 'L':
        e.preventDefault();
        skipTime(10);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setVolume(Math.min(video.volume + 0.1, 1));
        showFeedback(`Volume ${Math.round(video.volume * 100)}%`);
        break;
      case 'ArrowDown':
        e.preventDefault();
        setVolume(Math.max(video.volume - 0.1, 0));
        showFeedback(`Volume ${Math.round(video.volume * 100)}%`);
        break;
      case 'm':
      case 'M':
        e.preventDefault();
        toggleMute();
        break;
      case 'f':
      case 'F':
        e.preventDefault();
        toggleFullscreen();
        break;
      case 'e':
      case 'E':
        e.preventDefault();
        toggleEnhancement();
        break;
    }
  });

  // Set default initial state
  video.className = 'video-element enhanced-mode';
  setVolume(0.9);
});
