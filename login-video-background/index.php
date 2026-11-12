<?php

class LoginVideoBackgroundPlugin extends \RainLoop\Plugins\AbstractPlugin
{
	const
		NAME     = 'Login Video Background',
		VERSION  = '1.0',
		CATEGORY = 'General',
		DESCRIPTION = 'Displays a fullscreen HTML5 background video on the login screen.';

	public function Init() : void
	{
		$this->addCss('css/video.css');
		$this->addJs('js/video.js');
		$this->addHook('main.content-security-policy', 'FilterHttpCsp');
	}

	public function FilterHttpCsp(\SnappyMail\HTTP\CSP $CSP)
	{
		if (\method_exists($CSP, 'add')) {
			$CSP->add('media-src', 'https:');
		}
	}

	protected function configMapping() : array
	{
		return array(
			\RainLoop\Plugins\Property::NewInstance('video_url')
				->SetLabel('Video URL (.mp4 / .webm)')
				->SetType(\RainLoop\Enumerations\PluginPropertyType::URL)
				->SetDefaultValue('')
				->SetDescription('Direct URL to your background video file.')
		);
	}

	public function FilterAppDataPluginSection(bool $bAdmin, bool $bAuth, array &$aData) : void
	{
		if (!$bAuth && !$bAdmin) {
			$sUrl = \trim($this->Config()->Get('plugin', 'video_url', ''));
			if (!empty($sUrl)) {
				$aData['VideoUrl'] = $sUrl;
			}
		}
	}
}
