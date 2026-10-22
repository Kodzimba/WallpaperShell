param([string]$OutputDirectory)
$ErrorActionPreference='Stop'
if(!$OutputDirectory){$OutputDirectory=Join-Path (Split-Path -Parent $PSScriptRoot) 'identity\notifications\Assets'}
[void](New-Item -ItemType Directory -Force -Path $OutputDirectory)
Add-Type -AssemblyName System.Drawing
# Original geometric crescent, generated from vector primitives. No third-party
# logo, screenshot, source image or user data is used.
foreach($wsIcon in @(@('StoreLogo.png',50),@('Square44x44Logo.png',44),@('Square150x150Logo.png',150))){
 $wsSize=[int]$wsIcon[1];$wsBitmap=[Drawing.Bitmap]::new($wsSize,$wsSize)
 $wsGraphics=[Drawing.Graphics]::FromImage($wsBitmap)
 $wsBrush=[Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#B6D8F8'))
 $wsShape=[Drawing.Drawing2D.GraphicsPath]::new()
 $wsCut=[Drawing.Drawing2D.GraphicsPath]::new()
 try{
  $wsGraphics.SmoothingMode=[Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $wsGraphics.Clear([Drawing.Color]::Transparent)
  $wsShape.AddEllipse([single]($wsSize*.16),[single]($wsSize*.12),[single]($wsSize*.69),[single]($wsSize*.76))
  $wsCut.AddEllipse([single]($wsSize*.40),[single]($wsSize*.03),[single]($wsSize*.65),[single]($wsSize*.69))
  $wsRegion=[Drawing.Region]::new($wsShape)
  try{$wsRegion.Exclude($wsCut);$wsGraphics.FillRegion($wsBrush,$wsRegion)}finally{$wsRegion.Dispose()}
  $wsBitmap.Save((Join-Path $OutputDirectory $wsIcon[0]),[Drawing.Imaging.ImageFormat]::Png)
 }finally{$wsShape.Dispose();$wsCut.Dispose();$wsBrush.Dispose();$wsGraphics.Dispose();$wsBitmap.Dispose()}
}
