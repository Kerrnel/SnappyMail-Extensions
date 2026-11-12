<?php

class LoginWebglOceanPlugin extends \RainLoop\Plugins\AbstractPlugin
{
	const
		NAME     = 'Login WebGL Ocean',
		VERSION  = '1.1',
		CATEGORY = 'General',
		DESCRIPTION = 'Renders a time-of-day WebGL ocean shader with an optional floating PNG overlay on the login screen.';

	public function Init() : void
	{
		$this->addCss('css/ocean.css');
		$this->addJs('js/ocean.js');
		$this->addHook('main.content-security-policy', 'ContentSecurityPolicy');
	}

	public function ContentSecurityPolicy(\SnappyMail\HTTP\CSP $CSP) : void
	{
		if (\method_exists($CSP, 'add')) {
			$CSP->add('img-src', 'https:');
		}
	}

	protected function configMapping() : array
	{
		return array(
			\RainLoop\Plugins\Property::NewInstance('overlay_url')
				->SetLabel('Floating PNG Overlay URL (Optional)')
				->SetType(\RainLoop\Enumerations\PluginPropertyType::URL)
				->SetDefaultValue('')
				->SetDescription('Direct URL to a transparent PNG (e.g., boat, island, clouds, or logo) that gently floats over the ocean.'),
			\RainLoop\Plugins\Property::NewInstance('overlay_scale')
				->SetLabel('Overlay Width (px)')
				->SetType(\RainLoop\Enumerations\PluginPropertyType::INT)
				->SetDefaultValue(260)
				->SetDescription('Width of the floating PNG in pixels.'),
			\RainLoop\Plugins\Property::NewInstance('force_hour')
				->SetLabel('Force Hour (0–23, leave blank for real local time)')
				->SetType(\RainLoop\Enumerations\PluginPropertyType::STRING)
				->SetDefaultValue('')
				->SetDescription('Optional: test a specific hour (e.g., 18 for sunset, 22 for moonlight) or leave blank for live local clock.')
		);
	}

	public function FilterAppDataPluginSection(bool $bAdmin, bool $bAuth, array &$aData) : void
	{
		if (!$bAuth && !$bAdmin) {
			$aData['OverlayUrl'] = \trim($this->Config()->Get('plugin', 'overlay_url', ''));
			$aData['OverlayScale'] = (int) $this->Config()->Get('plugin', 'overlay_scale', 260);
			$aData['ForceHour'] = \trim($this->Config()->Get('plugin', 'force_hour', ''));
		}
	}
}
