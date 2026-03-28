function initializeHeroScene() {
  const canvas = document.getElementById('hero-canvas');

  if (!canvas || !window.THREE) {
    return;
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  const sphere = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.8, 12),
    new THREE.MeshPhysicalMaterial({
      color: 0x8e7dff,
      emissive: 0x1f7fff,
      emissiveIntensity: 0.65,
      metalness: 0.12,
      roughness: 0.2,
      transparent: true,
      opacity: 0.84,
      wireframe: true,
    })
  );

  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(1.2, 32, 32),
    new THREE.MeshBasicMaterial({ color: 0x22c7ff, transparent: true, opacity: 0.22 })
  );

  const pointLight = new THREE.PointLight(0x87f3ff, 3.2, 100);
  pointLight.position.set(2, 3, 4);

  scene.add(pointLight);
  scene.add(sphere);
  scene.add(glow);

  camera.position.z = 5.3;

  function tick() {
    sphere.rotation.x += 0.0026;
    sphere.rotation.y += 0.0034;
    glow.scale.setScalar(1 + Math.sin(Date.now() * 0.0012) * 0.06);
    renderer.render(scene, camera);
    window.requestAnimationFrame(tick);
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  tick();
}

function initializeRevealAnimations() {
  if (!window.anime) {
    return;
  }

  anime({
    targets: '.reveal',
    translateY: [22, 0],
    opacity: [0, 1],
    delay: anime.stagger(110),
    duration: 720,
    easing: 'easeOutExpo',
  });

  anime({
    targets: '.metric-card strong',
    scale: [0.94, 1],
    delay: anime.stagger(80, { start: 280 }),
    duration: 520,
    easing: 'easeOutBack',
  });
}

initializeHeroScene();
initializeRevealAnimations();