const FS_SOURCE = `
		precision highp float;
		uniform vec2 u_res;
		uniform float u_time;
		uniform vec2 u_mouse;
		uniform float u_hour; // 0.0 to 24.0

		// PCG-style 3D integer-like hash (no sin/trig stripes or twin dots)
		vec3 hash33(vec3 p3) {
			p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
			p3 += dot(p3, p3.yxz + 33.33);
			return fract((p3.xxy + p3.yxx) * p3.zyx);
		}

		float hash(vec2 p) {
			vec3 p3 = fract(vec3(p.xyx) * 0.1031);
			p3 += dot(p3, p3.yzx + 33.33);
			return fract((p3.x + p3.y) * p3.z);
		}

		float noise(vec2 p) {
			vec2 i = floor(p);
			vec2 f = fract(p);
			f = f * f * (3.0 - 2.0 * f);
			return mix(
				mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
				mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
				f.y
			);
		}

		float fbm(vec2 p) {
			float v = 0.0, a = 0.5;
			mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
			for (int i = 0; i < 4; i++) {
				v += a * noise(p);
				p = rot * p * 2.07;
				a *= 0.5;
			}
			return v;
		}

		float wave(vec2 p, vec2 dir, float freq, float speed, float time) {
			return sin(dot(p, dir) * freq + time * speed);
		}

		float seaHeightMacro(vec2 p, float t) {
			float h = 0.0, amp = 0.36, freq = 0.55;
			mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
			vec2 dir = vec2(0.85, 0.52);
			for (int i = 0; i < 5; i++) {
				float w = wave(p, dir, freq, 1.4 + float(i) * 0.28, t);
				h += amp * pow(0.5 + 0.5 * w, 2.1);
				p = rot * p;
				dir = normalize(rot * dir);
				freq *= 1.78;
				amp *= 0.47;
			}
			return h;
		}

		float seaHeightDetail(vec2 p, float t) {
			float h = 0.0, amp = 0.36, freq = 0.55;
			mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
			vec2 dir = vec2(0.85, 0.52);
			for (int i = 0; i < 8; i++) {
				float w = wave(p, dir, freq, 1.4 + float(i) * 0.32, t);
				float sharp = (i < 4) ? 2.2 : 1.5;
				h += amp * pow(0.5 + 0.5 * w, sharp);
				p = rot * p;
				dir = normalize(rot * dir);
				freq *= 1.82;
				amp *= 0.46;
			}
			return h;
		}

		vec3 getNormal(vec2 p, float t, float eps) {
			float h = seaHeightDetail(p, t);
			float hx = seaHeightDetail(p + vec2(eps, 0.0), t);
			float hz = seaHeightDetail(p + vec2(0.0, eps), t);
			return normalize(vec3(h - hx, eps, h - hz));
		}

		// 3D isotropic starfield: hashes 3D direction vectors directly so there is no 2D projection stripe
		vec3 starField3D(vec3 dir, float scale, float threshold, float sharpness, float time) {
			vec3 p = dir * scale;
			vec3 id = floor(p);
			vec3 local = fract(p) - 0.5;

			vec3 rnd = hash33(id);
			if (rnd.z < threshold) return vec3(0.0);

			// Jitter star center in 3D cell
			vec3 starPos = (rnd - 0.5) * 0.78;
			float d = length(local - starPos);

			float normMag = (rnd.z - threshold) / (1.0 - threshold);
			float mag = pow(normMag, 5.0);

			float star = smoothstep(0.42, 0.0, d) * exp(-d * sharpness);
			float halo = exp(-d * (sharpness * 0.25)) * 0.18 * mag;

			float twinkle = 0.72 + 0.28 * sin(time * (1.5 + rnd.x * 5.0) + rnd.y * 62.8);

			vec3 col = mix(vec3(1.0, 0.75, 0.55), vec3(0.95, 0.98, 1.0), smoothstep(0.0, 0.6, rnd.x));
			col = mix(col, vec3(0.65, 0.80, 1.0), smoothstep(0.6, 1.0, rnd.x));

			return col * (star + halo) * (0.15 + 1.9 * mag) * twinkle;
		}

		// 3D shooting star across the celestial sphere
		vec3 shootingStar3D(vec3 rd, float time) {
			float period = 6.0;
			float slot = floor(time / period);
			float localT = fract(time / period);

			vec3 rnd = hash33(vec3(slot, slot * 1.618, 7.13));
			if (rnd.z < 0.52 || localT > 0.15) return vec3(0.0);

			float prog = localT / 0.15;
			vec3 startDir = normalize(vec3((rnd.x - 0.5) * 1.4, 0.22 + rnd.y * 0.45, 0.75));
			vec3 moveDir = normalize(vec3((rnd.y - 0.5) * 0.9, -0.35 - rnd.x * 0.25, 0.15));

			vec3 head = normalize(startDir + moveDir * (prog * 0.42));
			vec3 tangent = normalize(moveDir - head * dot(moveDir, head));

			vec3 diff = rd - head;
			float along = dot(diff, -tangent);
			float trailLen = 0.14;
			float perp = length(diff - (-tangent) * clamp(along, 0.0, trailLen));

			float mask = smoothstep(0.0038, 0.0, perp) *
			             smoothstep(trailLen, 0.0, along) *
			             smoothstep(-0.002, 0.004, along);

			return vec3(0.85, 0.94, 1.0) * mask * sin(prog * 3.14159) * 2.8;
		}

		void getTimePalette(
			float hour,
			out vec3 skyHorizon,
			out vec3 skyZenith,
			out vec3 sunColor,
			out vec3 waterDeep,
			out vec3 waterShallow,
			out float sunElev,
			out float nightFactor
		) {
			float angle = (hour - 12.5) * 0.261799;
			sunElev = cos(angle);

			float dayFactor = smoothstep(-0.08, 0.28, sunElev);
			float goldenFactor = smoothstep(-0.22, 0.04, sunElev) * (1.0 - smoothstep(0.04, 0.34, sunElev));
			nightFactor = 1.0 - smoothstep(-0.25, 0.02, sunElev);

			vec3 dayHorizon = vec3(0.52, 0.74, 0.90);
			vec3 dayZenith  = vec3(0.10, 0.28, 0.56);
			vec3 daySun     = vec3(1.00, 0.95, 0.85);

			vec3 goldHorizon = vec3(0.95, 0.42, 0.22);
			vec3 goldZenith  = vec3(0.18, 0.14, 0.34);
			vec3 goldSun     = vec3(1.00, 0.55, 0.20);

			vec3 nightHorizon = vec3(0.04, 0.09, 0.17);
			vec3 nightZenith  = vec3(0.01, 0.03, 0.08);
			vec3 moonColor    = vec3(0.65, 0.78, 0.98);

			skyHorizon = mix(nightHorizon, dayHorizon, dayFactor);
			skyHorizon = mix(skyHorizon, goldHorizon, goldenFactor * 0.92);

			skyZenith = mix(nightZenith, dayZenith, dayFactor);
			skyZenith = mix(skyZenith, goldZenith, goldenFactor * 0.75);

			sunColor = mix(moonColor, daySun, dayFactor);
			sunColor = mix(sunColor, goldSun, goldenFactor);

			waterDeep = mix(vec3(0.005, 0.02, 0.05), vec3(0.01, 0.08, 0.17), dayFactor);
			waterShallow = mix(vec3(0.02, 0.07, 0.14), vec3(0.04, 0.28, 0.36), dayFactor);
			waterShallow = mix(waterShallow, vec3(0.28, 0.14, 0.10), goldenFactor * 0.5);
		}

		vec3 renderSky(
			vec3 rd,
			vec3 bodyDir,
			vec3 skyHorizon,
			vec3 skyZenith,
			vec3 sunColor,
			float nightFactor,
			bool isReflection
		) {
			float sunAmt = max(dot(rd, bodyDir), 0.0);
			vec3 sky = mix(skyHorizon, skyZenith, pow(max(rd.y, 0.0), 0.52));

			sky += sunColor * pow(sunAmt, 10.0) * (0.28 + 0.15 * (1.0 - nightFactor));
			sky += sunColor * smoothstep(0.9982, 0.9994, sunAmt) * 2.4;

			if (nightFactor > 0.05 && rd.y > 0.01) {
				// Slowly rotate celestial sphere over time
				float c = cos(u_time * 0.0012), s = sin(u_time * 0.0012);
				vec3 sDir = vec3(c * rd.x - s * rd.z, rd.y, s * rd.x + c * rd.z);

				// Irrational 3D rotation matrices to break any cubic axis alignment
				mat3 m1 = mat3(
					 0.80, -0.48,  0.36,
					 0.60,  0.64, -0.48,
					 0.00,  0.60,  0.80
				);
				mat3 m2 = mat3(
					-0.64,  0.48,  0.60,
					 0.36,  0.80, -0.48,
					-0.68, -0.36, -0.64
				);

				// Diagonal Milky Way plane + organic FBM cloud density
				vec3 galDir = m1 * sDir;
				vec2 galUV = galDir.xz / (abs(galDir.y) + 0.65);
				float band = exp(-pow((galDir.x + galDir.y * 0.55 - 0.18) * 2.6, 2.0));
				float cloud = fbm(galUV * 3.2 + fbm(galUV * 6.4) * 0.45);
				float dustLane = smoothstep(0.38, 0.68, fbm(galUV * 5.5 + vec2(2.1, 8.4)));
				float milkyWay = band * cloud * (1.0 - 0.55 * dustLane);

				float moonMask = 1.0 - smoothstep(0.92, 0.996, sunAmt);
				float horizonFade = smoothstep(0.015, 0.18, rd.y);
				float sharp = isReflection ? 10.0 : 18.0;

				// Modulate local star probability with FBM clouds so stars cluster organically
				float clusterNoise = fbm(galUV * 4.5 + vec2(11.3, 5.7));
				float densityMod = clamp(clusterNoise * 0.22 + milkyWay * 0.32, 0.0, 0.42);

				vec3 stars = vec3(0.0);
				// 5 de-correlated 3D octaves at irrational scales
				stars += starField3D(sDir, 65.0, 0.93 - densityMod * 0.15, sharp, u_time);
				stars += starField3D(m1 * sDir, 118.0, 0.90 - densityMod * 0.35, sharp * 1.1, u_time * 0.9) * 0.80;
				stars += starField3D(m2 * sDir, 195.0, 0.86 - densityMod * 0.55, sharp * 1.2, u_time * 0.8) * 0.55;
				stars += starField3D(m1 * m2 * sDir, 310.0, 0.82 - densityMod * 0.75, sharp * 1.3, u_time * 0.7) * 0.38;
				stars += starField3D(m2 * m1 * sDir, 460.0, 0.76 - densityMod * 0.95, sharp * 1.4, u_time * 0.6) * 0.25;

				// Diffuse Milky Way nebula glow
				vec3 nebulaCol = mix(vec3(0.04, 0.07, 0.15), vec3(0.11, 0.08, 0.16), cloud);
				stars += nebulaCol * milkyWay * 0.85;

				if (!isReflection) {
					stars += shootingStar3D(rd, u_time);
				}

				sky += stars * nightFactor * horizonFade * moonMask;
			}

			return sky;
		}

		void main() {
			vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;

			vec3 skyHorizon, skyZenith, sunColor, waterDeep, waterShallow;
			float sunElev, nightFactor;
			getTimePalette(u_hour, skyHorizon, skyZenith, sunColor, waterDeep, waterShallow, sunElev, nightFactor);

			float yaw = (u_mouse.x - 0.5) * 0.85;
			float pitch = -0.14 + (u_mouse.y - 0.5) * 0.22;

			vec3 ro = vec3(u_mouse.x * 2.5, 2.4, u_time * 0.85);
			vec3 rd = normalize(vec3(uv.x, uv.y + pitch, 1.18));

			float cy = cos(yaw), sy = sin(yaw);
			rd.xz = mat2(cy, -sy, sy, cy) * rd.xz;

			float bodyY = mix(0.16, 0.42, clamp(abs(sunElev), 0.0, 1.0));
			float bodyX = 0.35 + (u_mouse.x - 0.5) * 0.25;
			vec3 bodyDir = normalize(vec3(bodyX, bodyY, 0.88));

			vec3 skyCol = renderSky(rd, bodyDir, skyHorizon, skyZenith, sunColor, nightFactor, false);

			if (rd.y >= -0.004) {
				vec3 outSky = skyCol / (skyCol + vec3(0.62));
				outSky = pow(outSky, vec3(0.92));
				gl_FragColor = vec4(outSky, 1.0);
				return;
			}

			float dist = -ro.y / rd.y;
			vec3 pos = ro + rd * dist;
			for (int i = 0; i < 4; i++) {
				float h = seaHeightMacro(pos.xz, u_time);
				dist += (h - pos.y) / rd.y * 0.65;
				pos = ro + rd * dist;
			}

			float eps = max(0.007, dist * 0.0011);
			vec3 n = getNormal(pos.xz, u_time, eps);

			float fresnel = clamp(0.03 + 0.97 * pow(1.0 - max(dot(-rd, n), 0.0), 4.2), 0.0, 1.0);
			vec3 reflDir = reflect(rd, n);
			reflDir.y = max(reflDir.y, 0.015);
			vec3 reflCol = renderSky(reflDir, bodyDir, skyHorizon, skyZenith, sunColor, nightFactor, true);

			float hDetail = seaHeightDetail(pos.xz, u_time);
			float crest = clamp(hDetail * 1.15, 0.0, 1.0);
			vec3 waterCol = waterDeep + waterShallow * pow(crest, 2.2);

			float steepness = 1.0 - n.y;
			float foamNoise = fbm(pos.xz * 2.4 + vec2(u_time * 0.35, -u_time * 0.25));
			float whitecap = smoothstep(0.46, 0.66, hDetail * 0.72 + steepness * 1.15 + foamNoise * 0.26);
			whitecap *= smoothstep(95.0, 12.0, dist);

			vec3 foamTint = mix(vec3(0.92, 0.96, 1.0), sunColor * 0.85 + vec3(0.25), 0.35);
			foamTint *= mix(1.0, 0.32, nightFactor);

			vec3 halfVec = normalize(bodyDir - rd);
			float spec = pow(max(dot(n, halfVec), 0.0), 280.0);
			vec3 glitter = sunColor * spec * (nightFactor > 0.5 ? 1.6 : 2.6);

			vec3 col = mix(waterCol, reflCol, fresnel);
			col = mix(col, foamTint, clamp(whitecap * 0.82, 0.0, 1.0)) + glitter;

			float fog = 1.0 - exp(-dist * 0.011);
			col = mix(col, skyCol, clamp(fog, 0.0, 1.0));

			col = col / (col + vec3(0.62));
			col = pow(col, vec3(0.92));

			gl_FragColor = vec4(col, 1.0);
		}
	`;
