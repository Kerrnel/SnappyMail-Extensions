;(() => {
	let animId = null;

	const VS_SOURCE = `
		attribute vec2 a_pos;
		void main() {
			gl_Position = vec4(a_pos, 0.0, 1.0);
		}
	`;

	const FS_SOURCE = `
		precision highp float;
		uniform vec2 u_res;
		uniform float u_time;
		uniform vec2 u_mouse;
		uniform float u_hour; // 0.0 to 24.0
		uniform float u_dark; // 0.0 = light theme, 1.0 = dark theme

		float hash(vec2 p) {
			vec3 p3 = fract(vec3(p.xyx) * 0.1031);
			p3 += dot(p3, p3.yzx + 33.33);
			return fract((p3.x + p3.y) * p3.z);
		}

		vec3 hash32(vec2 p) {
			vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
			p3 += dot(p3, p3.yxz + 33.33);
			return fract((p3.xxy + p3.yzz) * p3.zyx);
		}

		float noise(vec2 p) {
			vec2 i = floor(p);
			vec2 f = fract(p);
			f = f * f * (3.0 - 2.0 * f);
			float a = hash(i);
			float b = hash(i + vec2(1.0, 0.0));
			float c = hash(i + vec2(0.0, 1.0));
			float d = hash(i + vec2(1.0, 1.0));
			return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
		}

		float fbm(vec2 p) {
			float v = 0.0;
			float a = 0.5;
			mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
			for (int i = 0; i < 3; i++) {
				v += a * noise(p);
				p = rot * p * 2.05;
				a *= 0.5;
			}
			return v;
		}

		// Billow noise FBM: creates rounded, puffy cumulus lobes instead of flat haze
		float puffFbm(vec2 p) {
			float v = 0.0;
			float a = 0.52;
			mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
			for (int i = 0; i < 4; i++) {
				float n = noise(p);
				// Fold noise so creases become sharp valleys and centers puff up
				float billow = 1.0 - abs(n * 2.0 - 1.0);
				v += a * pow(billow, 1.35);
				p = rot * p * 2.12;
				a *= 0.48;
			}
			return v;
		}

		float wave(vec2 p, vec2 dir, float freq, float speed, float time) {
			return sin(dot(p, dir) * freq + time * speed);
		}

		float seaHeightMacro(vec2 p, float t) {
			float h = 0.0;
			float amp = 0.36;
			float freq = 0.55;
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
			float h = 0.0;
			float amp = 0.36;
			float freq = 0.55;
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

		vec3 starLayer(vec2 angUV, float scale, float density, float sharpness, float time) {
			vec2 uv = angUV * scale;
			vec2 id = floor(uv);
			vec2 gv = fract(uv) - 0.5;

			vec3 rnd = hash32(id);
			if (rnd.z < density) return vec3(0.0);

			vec2 pos = (rnd.xy - 0.5) * 0.76;
			vec2 delta = gv - pos;
			float d = length(delta);

			float normMag = (rnd.z - density) / (1.0 - density);
			float mag = pow(normMag, 5.5);

			float core = exp(-d * sharpness);
			float halo = exp(-d * (sharpness * 0.28)) * 0.22 * mag;
			float star = core + halo;

			if (normMag > 0.94) {
				float spike = (exp(-abs(delta.x) * sharpness * 1.4) * exp(-abs(delta.y) * 9.0) +
				               exp(-abs(delta.y) * sharpness * 1.4) * exp(-abs(delta.x) * 9.0)) * 0.35 * mag;
				star += spike;
			}

			float twinkle = 1.0 - (0.38 * (1.0 - mag * 0.5)) * (0.5 + 0.5 * sin(time * (2.0 + rnd.x * 5.0) + rnd.y * 60.0));

			vec3 col = mix(vec3(1.0, 0.76, 0.58), vec3(0.98, 0.99, 1.0), smoothstep(0.0, 0.55, rnd.x));
			col = mix(col, vec3(0.68, 0.82, 1.0), smoothstep(0.55, 1.0, rnd.x));

			return col * star * (0.12 + 1.85 * mag) * twinkle;
		}

		vec3 shootingStar(vec2 angUV, float time) {
			float period = 6.5;
			float slot = floor(time / period);
			float localT = fract(time / period);

			vec3 rnd = hash32(vec2(slot, slot * 2.17));
			if (rnd.z < 0.58 || localT > 0.14) return vec3(0.0);

			float prog = localT / 0.14;
			vec2 startPos = vec2((rnd.x - 0.5) * 0.9, 0.18 + rnd.y * 0.32);
			float angle = -2.45 + (rnd.z - 0.5) * 0.55;
			vec2 dir = vec2(cos(angle), sin(angle));

			float pathLen = 0.55;
			float trailLen = 0.18;
			vec2 head = startPos + dir * (prog * pathLen);

			vec2 toPix = angUV - head;
			float along = dot(toPix, -dir);
			float perp = length(toPix - (-dir) * clamp(along, 0.0, trailLen));

			float mask = smoothstep(0.0045, 0.0, perp) *
			             smoothstep(trailLen, 0.0, along) *
			             smoothstep(-0.002, 0.005, along);

			float fade = sin(prog * 3.14159265);
			return vec3(0.85, 0.94, 1.0) * mask * fade * 2.6;
		}

		float rainStreaks(vec2 uv, float time) {
			mat2 tilt = mat2(0.97, -0.24, 0.24, 0.97);
			vec2 p = tilt * uv;
			float r = 0.0;

			for (int i = 0; i < 2; i++) {
				float fi = float(i);
				vec2 scale = vec2(42.0 + fi * 26.0, 2.6 + fi * 1.1);
				vec2 st = p * scale + vec2(fi * 17.3, time * (7.5 + fi * 3.5));
				vec2 id = floor(st);
				vec2 f = fract(st);

				vec3 rnd = hash32(id);
				if (rnd.z > 0.72) {
					float xOff = 0.2 + rnd.x * 0.6;
					float drop = smoothstep(0.09, 0.0, abs(f.x - xOff)) *
					             smoothstep(0.0, 0.25, f.y) *
					             smoothstep(1.0, 0.35, f.y);
					r += drop * (0.55 - fi * 0.2);
				}
			}
			return r;
		}

		// Occasional forked lightning + in-cloud sheet flash during storms
		void evalLightning(vec3 rd, float time, float stormFactor, out vec3 boltCol, out float sheetFlash, out vec2 strikeXZ) {
			boltCol = vec3(0.0);
			sheetFlash = 0.0;
			strikeXZ = vec2(0.0);
			if (stormFactor < 0.02) return;

			float period = 5.2;
			float slot = floor(time / period);
			float localT = fract(time / period);

			vec3 rnd = hash32(vec2(slot, 91.7));
			// Trigger in ~70% of 5.2s storm windows, active for ~0.75s
			if (rnd.z < 0.30 || localT > 0.145) return;

			float u = localT / 0.145;
			// Realistic multi-stroke stepped leader + main return stroke + afterglow
			float flicker = exp(-pow((u - 0.15) * 10.0, 2.0)) * 0.85 +
			                exp(-pow((u - 0.45) * 6.5, 2.0)) * 1.15 +
			                exp(-pow((u - 0.78) * 11.0, 2.0)) * 0.60;
			flicker *= stormFactor;
			sheetFlash = flicker;

			// Keep strike within central visible azimuth (-0.48 to +0.48)
			float boltX = (rnd.x - 0.5) * 0.95;
			strikeXZ = vec2(boltX, 0.88);

			if (rd.y > -0.01 && rd.z > 0.1) {
				vec2 skyP = vec2(rd.x / rd.z, rd.y);
				// Bolt runs from cloud base (y ~ 0.46) down to horizon (y = 0.0)
				float yMask = smoothstep(0.0, 0.03, skyP.y) * smoothstep(0.50, 0.24, skyP.y);

				// Jagged FBM displacement for main trunk
				float jag = (fbm(vec2(skyP.y * 16.0, slot * 4.3)) - 0.5) * 0.14;
				jag += (noise(vec2(skyP.y * 48.0, slot * 11.1)) - 0.5) * 0.035;

				float dMain = abs(skyP.x - (boltX + jag));
				float core = exp(-dMain * 85.0) * yMask;
				float glow = exp(-dMain * 9.5) * yMask * 0.55;

				// Secondary fork branching off mid-air
				float branchY = 0.16 + rnd.y * 0.16;
				if (skyP.y < branchY) {
					float forkSign = (rnd.x > 0.5) ? 1.0 : -1.0;
					float forkX = boltX + jag + (branchY - skyP.y) * 0.58 * forkSign;
					forkX += (noise(vec2(skyP.y * 38.0, slot * 7.7)) - 0.5) * 0.04;
					float dFork = abs(skyP.x - forkX);
					float forkMask = smoothstep(0.01, branchY, skyP.y);
					core += exp(-dFork * 110.0) * forkMask * 0.65;
					glow += exp(-dFork * 14.0) * forkMask * 0.30;
				}

				boltCol = vec3(0.80, 0.90, 1.0) * (core * 4.5 + glow * 1.4) * flicker;
			}
		}

		void getTimePalette(
			float hour,
			out vec3 skyHorizon,
			out vec3 skyZenith,
			out vec3 sunColor,
			out vec3 waterDeep,
			out vec3 waterShallow,
			out float sunElev,
			out float nightFactor,
			out float stormFactor
		) {
			float angle = (hour - 12.5) * 0.261799;
			sunElev = cos(angle);

			float dayFactor = smoothstep(-0.08, 0.28, sunElev);
			float goldenFactor = smoothstep(-0.22, 0.04, sunElev) * (1.0 - smoothstep(0.04, 0.34, sunElev));
			nightFactor = 1.0 - smoothstep(-0.25, 0.02, sunElev);

			stormFactor = u_dark * (1.0 - nightFactor);

			// Morning (06:00-12:00) vs Afternoon (12:00-18:00) asymmetry:
			// 1.0 in morning (crisper, bluer), 0.0 in afternoon (warmer, slightly deeper)
			float isMorning = smoothstep(13.5, 10.5, hour);

			// Brightness curve that peaks around solar noon and dims toward 6 AM / 6 PM
			// Ranges from 0.68 near 6:00/18:00 up to 1.08 at 12:30 noon
			float solarBright = mix(0.68, 1.08, clamp(sunElev, 0.0, 1.0));

			// Morning palette (6-12): crisp, high-cobalt/azure blue
			vec3 mornHorizon = vec3(0.42, 0.70, 0.95);
			vec3 mornZenith  = vec3(0.06, 0.26, 0.62);

			// Afternoon palette (12-6): slightly warmer, hazier marine blue (less blue-dominant)
			vec3 aftHorizon  = vec3(0.46, 0.65, 0.80);
			vec3 aftZenith   = vec3(0.09, 0.21, 0.44);

			vec3 dayHorizon = mix(aftHorizon, mornHorizon, isMorning) * solarBright;
			vec3 dayZenith  = mix(aftZenith,  mornZenith,  isMorning) * solarBright;
			vec3 daySun     = mix(vec3(1.00, 0.93, 0.82), vec3(0.98, 0.98, 1.00), isMorning);

			// Dark Mode storm palette also scales brightness & blueness with morning/afternoon + solar elevation
			float stormBright = mix(0.62, 1.12, clamp(sunElev, 0.0, 1.0));
			vec3 stormHorizon = mix(vec3(0.18, 0.20, 0.24), vec3(0.15, 0.22, 0.31), isMorning) * stormBright;
			vec3 stormZenith  = mix(vec3(0.06, 0.07, 0.10), vec3(0.04, 0.08, 0.15), isMorning) * stormBright;
			vec3 stormSun     = vec3(0.45, 0.50, 0.56) * stormBright;

			dayHorizon = mix(dayHorizon, stormHorizon, stormFactor);
			dayZenith  = mix(dayZenith,  stormZenith,  stormFactor);
			daySun     = mix(daySun,     stormSun,     stormFactor);

			vec3 goldHorizon = vec3(0.95, 0.42, 0.22);
			vec3 goldZenith  = vec3(0.18, 0.14, 0.34);
			vec3 goldSun     = vec3(1.00, 0.55, 0.20);

			vec3 nightHorizon = vec3(0.04, 0.09, 0.17);
			vec3 nightZenith  = vec3(0.01, 0.03, 0.08);
			vec3 moonColor    = vec3(0.65, 0.78, 0.98);

			float goldMix = goldenFactor * (1.0 - 0.65 * stormFactor);

			skyHorizon = mix(nightHorizon, dayHorizon, dayFactor);
			skyHorizon = mix(skyHorizon, goldHorizon, goldMix * 0.92);

			skyZenith = mix(nightZenith, dayZenith, dayFactor);
			skyZenith = mix(skyZenith, goldZenith, goldMix * 0.75);

			sunColor = mix(moonColor, daySun, dayFactor);
			sunColor = mix(sunColor, goldSun, goldMix);

			vec3 dayDeep    = mix(vec3(0.01, 0.09, 0.20), vec3(0.015, 0.03, 0.045), stormFactor) * solarBright;
			vec3 dayShallow = mix(vec3(0.04, 0.28, 0.38), vec3(0.04, 0.08, 0.11),  stormFactor) * solarBright;

			waterDeep = mix(vec3(0.005, 0.02, 0.05), dayDeep, dayFactor);
			waterShallow = mix(vec3(0.02, 0.07, 0.14), dayShallow, dayFactor);
			waterShallow = mix(waterShallow, vec3(0.28, 0.14, 0.10), goldMix * 0.5);
		}

		vec3 renderSky(
			vec3 rd,
			vec3 bodyDir,
			vec3 skyHorizon,
			vec3 skyZenith,
			vec3 sunColor,
			float nightFactor,
			float stormFactor,
			bool isReflection
		) {
			float sunAmt = max(dot(rd, bodyDir), 0.0);
			vec3 sky = mix(skyHorizon, skyZenith, pow(max(rd.y, 0.0), 0.52));

			float discVis = 1.0 - 0.85 * stormFactor;
			sky += sunColor * pow(sunAmt, mix(10.0, 4.0, stormFactor)) * (0.28 + 0.15 * (1.0 - nightFactor));
			sky += sunColor * smoothstep(0.9982, 0.9994, sunAmt) * 2.4 * discVis;

			if (nightFactor > 0.05 && rd.y > 0.005) {
				float az = atan(rd.x, rd.z);
				float el = asin(clamp(rd.y, 0.0, 1.0));
				vec2 angUV = vec2(az * cos(el * 0.65), el) + vec2(u_time * 0.0008, 0.0);

				mat2 rot1 = mat2(0.921, -0.389, 0.389, 0.921);
				mat2 rot2 = mat2(0.642,  0.766, -0.766, 0.642);

				vec2 mwCoord = rot1 * angUV;
				float mwBand = exp(-pow((mwCoord.y - 0.32) * 3.8, 2.0));
				float mwCloud = fbm(mwCoord * 6.5 + vec2(4.2, 1.7)) * mwBand;

				float moonMask = 1.0 - smoothstep(0.92, 0.996, sunAmt);
				float horizonFade = smoothstep(0.01, 0.16, rd.y);

				float sharpBoost = isReflection ? 18.0 : 34.0;
				vec3 stars = vec3(0.0);

				stars += starLayer(angUV, 36.0, 0.88, sharpBoost, u_time);
				stars += starLayer(rot1 * angUV + vec2(17.3, 41.9), 78.0, 0.76, sharpBoost * 1.15, u_time * 0.9) * 0.65;

				float dustDensity = mix(0.74, 0.48, mwBand);
				stars += starLayer(rot2 * angUV + vec2(83.1, 12.6), 155.0, dustDensity, sharpBoost * 1.3, u_time * 0.7) * 0.35;

				stars += vec3(0.05, 0.08, 0.14) * mwCloud * 0.45;

				if (!isReflection) {
					stars += shootingStar(angUV, u_time);
				}

				sky += stars * nightFactor * horizonFade * moonMask;
			}

			// Evaluate storm lightning
			vec3 boltCol;
			float sheetFlash;
			vec2 strikeXZ;
			evalLightning(rd, u_time, stormFactor, boltCol, sheetFlash, strikeXZ);

			// Ambient sky flash during lightning strike
			sky += vec3(0.28, 0.36, 0.52) * sheetFlash * 0.45;

			// Discrete puffy cumulus clouds
			if (rd.y > 0.015) {
				vec2 cloudUV = rd.xz / (rd.y + 0.18);
				float windSpeed = mix(1.0, 1.8, stormFactor);
				vec2 wind = vec2(u_time * 0.022, u_time * 0.008) * windSpeed;

				vec2 q = cloudUV * 0.55 + wind;
				float macroGroup = noise(q * 0.55 - wind * 0.3);
				float puffs = isReflection ? fbm(q * 1.5) : puffFbm(q * 1.5);

				float shape = macroGroup * 0.58 + puffs * 0.56;
				float covLow  = mix(0.60, 0.44, stormFactor);
				float covHigh = mix(0.80, 0.68, stormFactor);
				float density = smoothstep(covLow, covHigh, shape);

				float horizonFade = smoothstep(0.03, 0.22, rd.y);
				density *= horizonFade;

				if (density > 0.002) {
					vec2 sunStep = normalize(bodyDir.xz) * 0.08;
					float shadowSample = puffFbm((q + sunStep) * 1.5);
					float relief = clamp((puffs - shadowSample) * 1.6 + 0.5, 0.0, 1.0);
					float thickness = clamp((shape - covLow) * 2.4, 0.0, 1.0);

					float dayAmt = 1.0 - nightFactor;
					vec3 sunnyTop  = mix(vec3(0.99, 0.99, 1.00), vec3(0.36, 0.41, 0.48), stormFactor);
					vec3 sunnyBase = mix(vec3(0.52, 0.62, 0.74), vec3(0.10, 0.13, 0.18), stormFactor);

					vec3 cloudTop  = mix(vec3(0.16, 0.22, 0.34), sunnyTop,  dayAmt);
					vec3 cloudBase = mix(vec3(0.03, 0.06, 0.12), sunnyBase, dayAmt);

					float sunsetGlow = clamp(1.0 - abs(bodyDir.y - 0.20) * 4.5, 0.0, 1.0) * dayAmt * (1.0 - 0.7 * stormFactor);
					cloudTop  = mix(cloudTop,  sunColor * 1.15, sunsetGlow * 0.65);
					cloudBase = mix(cloudBase, vec3(0.32, 0.18, 0.28), sunsetGlow * 0.55);

					vec3 cloudCol = mix(cloudBase, cloudTop, relief * (1.0 - thickness * 0.45));

					float edge = density * (1.0 - density) * 4.0;
					float mie = pow(sunAmt, 5.0) * edge;
					cloudCol += sunColor * mie * (0.65 * dayAmt + 0.20) * (1.0 - 0.5 * stormFactor);

					// Bright internal cloud illumination near the lightning bolt
					if (sheetFlash > 0.01) {
						float prox = exp(-length(rd.xz - strikeXZ) * 1.6);
						cloudCol += vec3(0.65, 0.80, 1.0) * sheetFlash * (0.25 + 0.95 * prox);
					}

					sky = mix(sky, cloudCol, density * 0.94);
				}
			}

			// Add the lightning bolt on top of the cloud deck so clouds don't hide the trunk
			sky += boltCol;
			return sky;
		}

		void main() {
			vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;

			vec3 skyHorizon, skyZenith, sunColor, waterDeep, waterShallow;
			float sunElev, nightFactor, stormFactor;
			getTimePalette(u_hour, skyHorizon, skyZenith, sunColor, waterDeep, waterShallow, sunElev, nightFactor, stormFactor);

			float yaw = (u_mouse.x - 0.5) * 0.85;
			float pitch = -0.14 + (u_mouse.y - 0.5) * 0.22;

			vec3 ro = vec3(u_mouse.x * 2.5, 2.4, u_time * 0.85);
			vec3 rd = normalize(vec3(uv.x, uv.y + pitch, 1.18));

			float cy = cos(yaw), sy = sin(yaw);
			rd.xz = mat2(cy, -sy, sy, cy) * rd.xz;

			float bodyY = mix(0.16, 0.42, clamp(abs(sunElev), 0.0, 1.0));
			float bodyX = 0.35 + (u_mouse.x - 0.5) * 0.25;
			vec3 bodyDir = normalize(vec3(bodyX, bodyY, 0.88));

			vec3 skyCol = renderSky(rd, bodyDir, skyHorizon, skyZenith, sunColor, nightFactor, stormFactor, false);

			float rain = (stormFactor > 0.01) ? rainStreaks(uv, u_time) * stormFactor : 0.0;

			if (rd.y >= -0.004) {
				vec3 outSky = skyCol + vec3(0.55, 0.62, 0.70) * rain * 0.28;
				outSky = outSky / (outSky + vec3(0.62));
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

			if (stormFactor > 0.01 && dist < 35.0) {
				vec2 dropUV = pos.xz * 7.5;
				vec2 dropID = floor(dropUV);
				vec2 dropF  = fract(dropUV) - 0.5;
				vec3 dropRnd = hash32(dropID + floor(u_time * 4.0));
				float ring = sin(length(dropF - (dropRnd.xy - 0.5) * 0.5) * 38.0 - fract(u_time * 4.0 + dropRnd.z) * 18.0);
				float atten = smoothstep(0.45, 0.0, length(dropF)) * smoothstep(35.0, 4.0, dist);
				n = normalize(n + vec3(ring, 0.0, ring) * 0.035 * atten * stormFactor);
			}

			float fresnel = clamp(0.03 + 0.97 * pow(1.0 - max(dot(-rd, n), 0.0), 4.2), 0.0, 1.0);
			vec3 reflDir = reflect(rd, n);
			reflDir.y = max(reflDir.y, 0.015);
			vec3 reflCol = renderSky(reflDir, bodyDir, skyHorizon, skyZenith, sunColor, nightFactor, stormFactor, true);

			float hDetail = seaHeightDetail(pos.xz, u_time);
			float crest = clamp(hDetail * 1.15, 0.0, 1.0);
			vec3 waterCol = waterDeep + waterShallow * pow(crest, 2.2);

			float steepness = 1.0 - n.y;
			float foamNoise = fbm(pos.xz * 2.4 + vec2(u_time * 0.35, -u_time * 0.25));
			float foamThresh = mix(0.46, 0.41, stormFactor);
			float whitecap = smoothstep(foamThresh, foamThresh + 0.20, hDetail * 0.72 + steepness * 1.15 + foamNoise * 0.26);
			whitecap *= smoothstep(95.0, 12.0, dist);

			vec3 foamTint = mix(vec3(0.92, 0.96, 1.0), sunColor * 0.85 + vec3(0.25), 0.35);
			foamTint *= mix(1.0, 0.32, max(nightFactor, stormFactor * 0.75));

			vec3 halfVec = normalize(bodyDir - rd);
			float spec = pow(max(dot(n, halfVec), 0.0), 280.0);
			vec3 glitter = sunColor * spec * (nightFactor > 0.5 ? 1.6 : mix(2.6, 0.45, stormFactor));

			vec3 col = mix(waterCol, reflCol, fresnel);
			col = mix(col, foamTint, clamp(whitecap * 0.82, 0.0, 1.0)) + glitter;

			// Reduced horizon fog so clouds stay crisp rather than washing into haze
			float fogDensity = mix(0.0085, 0.016, stormFactor);
			float fog = 1.0 - exp(-dist * fogDensity);
			col = mix(col, skyCol, clamp(fog, 0.0, 1.0));

			col += vec3(0.50, 0.58, 0.66) * rain * 0.25;

			col = col / (col + vec3(0.62));
			col = pow(col, vec3(0.92));

			gl_FragColor = vec4(col, 1.0);
		}
	`;

	const startOcean = () => {
		const rl = window.rl;
		if (!rl || typeof rl.pluginSettingsGet !== 'function') return false;

		const loginEl = document.querySelector('#rl-logins, .V-Login, input[name="Email"], #Email');
		if (!loginEl) return false;

		const existing = document.getElementById('snappy-ocean-canvas');
		if (existing) {
			if (animId) return true;
			existing.remove();
		}

		// Read plugin settings
		const overlayUrl = rl.pluginSettingsGet('login-webgl-ocean', 'OverlayUrl');
		const overlayScale = rl.pluginSettingsGet('login-webgl-ocean', 'OverlayScale') || 260;
		const forceHourStr = rl.pluginSettingsGet('login-webgl-ocean', 'ForceHour');

		// Optional floating PNG overlay
		if (overlayUrl && !document.getElementById('snappy-ocean-overlay')) {
			const img = document.createElement('img');
			img.id = 'snappy-ocean-overlay';
			img.src = overlayUrl;
			img.alt = '';
			img.style.width = `${overlayScale}px`;
			document.body.prepend(img);
		}

		const canvas = document.createElement('canvas');
		canvas.id = 'snappy-ocean-canvas';
		document.body.prepend(canvas);

		const gl = canvas.getContext('webgl', { antialias: false, powerPreference: 'low-power' });
		if (!gl) {
			canvas.remove();
			return true;
		}

		const compile = (type, src) => {
			const s = gl.createShader(type);
			gl.shaderSource(s, src);
			gl.compileShader(s);
			return s;
		};

		const prog = gl.createProgram();
		gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS_SOURCE));
		gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS_SOURCE));
		gl.linkProgram(prog);
		gl.useProgram(prog);

		const buf = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, buf);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

		const posLoc = gl.getAttribLocation(prog, 'a_pos');
		gl.enableVertexAttribArray(posLoc);
		gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

		const resLoc = gl.getUniformLocation(prog, 'u_res');
		const timeLoc = gl.getUniformLocation(prog, 'u_time');
		const mouseLoc = gl.getUniformLocation(prog, 'u_mouse');
		const hourLoc = gl.getUniformLocation(prog, 'u_hour');
		const darkLoc = gl.getUniformLocation(prog, 'u_dark');

		const darkMedia = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
		const isDarkTheme = () => {
			if (document.documentElement.classList.contains('rl-dark') || document.body.classList.contains('dark')) {
				return 1.0;
			}
			return (darkMedia && darkMedia.matches) ? 1.0 : 0.0;
		};

		let targetX = 0.5, targetY = 0.5;
		let curX = 0.5, curY = 0.5;
		let curDark = isDarkTheme();

		const onMove = (e) => {
			targetX = e.clientX / window.innerWidth;
			targetY = 1.0 - e.clientY / window.innerHeight;
		};
		window.addEventListener('mousemove', onMove, { passive: true });

		const resize = () => {
			const dpr = Math.min(window.devicePixelRatio || 1, 1.25) * 0.85;
			canvas.width = Math.floor(window.innerWidth * dpr);
			canvas.height = Math.floor(window.innerHeight * dpr);
			gl.viewport(0, 0, canvas.width, canvas.height);
		};
		window.addEventListener('resize', resize);
		resize();

		const getCurrentHour = () => {
			if (forceHourStr !== '' && forceHourStr !== null && !isNaN(parseFloat(forceHourStr))) {
				return parseFloat(forceHourStr);
			}
			const now = new Date();
			return now.getHours() + now.getMinutes() / 60;
		};

		const start = performance.now();
		const render = (now) => {
			const c = document.getElementById('snappy-ocean-canvas');
			if (!c) {
				window.removeEventListener('mousemove', onMove);
				window.removeEventListener('resize', resize);
				return;
			}
			curX += (targetX - curX) * 0.05;
			curY += (targetY - curY) * 0.05;
			// Smoothly crossfade weather if the user toggles OS Dark Mode live
			curDark += (isDarkTheme() - curDark) * 0.04;

			gl.uniform2f(resLoc, canvas.width, canvas.height);
			gl.uniform1f(timeLoc, (now - start) * 0.001);
			gl.uniform2f(mouseLoc, curX, curY);
			gl.uniform1f(hourLoc, getCurrentHour());
			gl.uniform1f(darkLoc, curDark);
			gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

			animId = requestAnimationFrame(render);
		};
		animId = requestAnimationFrame(render);
		return true;
	};

	const stopOcean = () => {
		if (animId) {
			cancelAnimationFrame(animId);
			animId = null;
		}
		const existingCanvas = document.getElementById('snappy-ocean-canvas');
		if (existingCanvas) existingCanvas.remove();
		const existingOverlay = document.getElementById('snappy-ocean-overlay');
		if (existingOverlay) existingOverlay.remove();
	};

	const isLoginScreenActive = () => {
		const loginView = document.querySelector('.V-Login');
		if (loginView) {
			return !loginView.hidden && loginView.offsetParent !== null;
		}
		return Boolean(document.querySelector('#rl-logins, input[name="Email"], #Email'));
	};

	if (!startOcean()) {
		const timer = setInterval(() => {
			if (startOcean()) clearInterval(timer);
		}, 150);
		setTimeout(() => clearInterval(timer), 15000);
	}

	addEventListener('rl-view-model', (e) => {
		const tpl = e.detail && e.detail.viewModelTemplateID;
		if (!tpl) return;

		if (tpl === 'Login' || tpl === 'AdminLogin') {
			startOcean();
		} else if (tpl === 'Mail' || tpl === 'Admin' || !isLoginScreenActive()) {
			stopOcean();
		}
	});
})();