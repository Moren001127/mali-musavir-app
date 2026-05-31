const { spawnSync } = require('child_process');

const TARGET = 'username-password-token/hattat-musavir';

const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace HattatCredWrite {
public class Native {
[StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
public struct CREDENTIAL {
  public UInt32 Flags;
  public UInt32 Type;
  public string TargetName;
  public string Comment;
  public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
  public UInt32 CredentialBlobSize;
  public IntPtr CredentialBlob;
  public UInt32 Persist;
  public UInt32 AttributeCount;
  public IntPtr Attributes;
  public string TargetAlias;
  public string UserName;
}
[DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
public static extern bool CredWrite(ref CREDENTIAL credential, UInt32 flags);
}
}
'@

$cred = Get-Credential -Message 'Hattat web e-posta/kullanici adi ve sifresini girin'
if ($null -eq $cred) { throw 'Hattat credential girisi iptal edildi' }

$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($cred.Password)
$blob = [IntPtr]::Zero
try {
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringUni($bstr)
  if ([string]::IsNullOrWhiteSpace($cred.UserName) -or [string]::IsNullOrWhiteSpace($plain)) {
    throw 'Kullanici adi ve sifre bos olamaz'
  }
  $json = @{ username = $cred.UserName; password = $plain } | ConvertTo-Json -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $blob = [Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
  [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $blob, $bytes.Length)

  $item = New-Object HattatCredWrite.Native+CREDENTIAL
  $item.Flags = 0
  $item.Type = 1
  $item.TargetName = '${TARGET}'
  $item.CredentialBlobSize = $bytes.Length
  $item.CredentialBlob = $blob
  $item.Persist = 2
  $item.UserName = $cred.UserName

  if (-not [HattatCredWrite.Native]::CredWrite([ref]$item, 0)) {
    $err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    throw (New-Object ComponentModel.Win32Exception($err))
  }
  Write-Host 'Hattat giris bilgisi Windows Credential Manager icine kaydedildi.'
} finally {
  if ($blob -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::FreeHGlobal($blob) }
  if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}
`;

const res = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
  stdio: 'inherit',
  windowsHide: false,
});

process.exit(typeof res.status === 'number' ? res.status : 1);
