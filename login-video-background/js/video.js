;(() => {
	const injectVideo = () => {
		const rl = window.rl;
		if (!rl || typeof rl.pluginSettingsGet !== 'function') return false;

		// Wait until SnappyMail actually renders the login form in the DOM
		const loginEl = document.querySelector('#rl-logins, .V-Login, input[name="Email"], #Email');
		if (!loginEl) return false;

		const videoUrl = rl.pluginSettingsGet('login-video-background', 'VideoUrl');
		if (!videoUrl) videoUrl = 'https://archive.org/download/ocean-life-from-a-to-z-dvd/OCEAN_LIFE.mp4';
		if (document.getElementById('snappy-bg-video')) return true;

		// console.log('[LoginVideo] Injecting video:', videoUrl);

		const video = document.createElement('video');
		video.id = 'snappy-bg-video';
		video.src = videoUrl;
		video.autoplay = true;
		video.loop = true;
		video.muted = true;
		video.playsInline = true;

		document.body.prepend(video);
		video.play().catch((err) => console.error('[LoginVideo] Play blocked:', err));
		return true;
	};

	// Poll every 150ms until the login screen renders and video is injected
	if (!injectVideo()) {
		const timer = setInterval(() => {
			if (injectVideo()) clearInterval(timer);
		}, 150);
		setTimeout(() => clearInterval(timer), 15000);
	}

	// Re-inject on logout or remove when logged in
	addEventListener('rl-view-model', (e) => {
		if (e.detail && e.detail.viewModelTemplateID === 'Login') {
			injectVideo();
		} else if (e.detail && e.detail.viewModelTemplateID !== 'Login') {
			const existing = document.getElementById('snappy-bg-video');
			if (existing) existing.remove();
		}
	});
})();
