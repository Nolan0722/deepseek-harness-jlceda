param([Parameter(Mandatory=$true)][string]$Profile)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$profilePath = [IO.Path]::GetFullPath($Profile)
if (-not [IO.Directory]::Exists($profilePath)) { throw 'Isolated profile does not exist' }
$directory = [IO.Path]::Combine($profilePath, 'dsh-temp')
$caller = [Security.Principal.WindowsIdentity]::GetCurrent().User
$inheritance = [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
if (-not [IO.Directory]::Exists($directory)) {
    # Supply permissions at creation; do not inherit an E: drive's Modify-only user grant.
    $security = New-Object Security.AccessControl.DirectorySecurity
    $security.SetOwner($caller)
    $security.SetAccessRuleProtection($true, $false)
    foreach ($sid in @($caller, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
        $security.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
            $sid, [Security.AccessControl.FileSystemRights]::FullControl, $inheritance,
            [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow))
    }
    [IO.Directory]::CreateDirectory($directory, $security) | Out-Null
}
$info = [IO.DirectoryInfo]::new($directory)
if ($info.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'DSH temp cannot be a reparse point' }
$actual = $info.GetAccessControl([Security.AccessControl.AccessControlSections]'Access,Owner')
if ($actual.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $caller.Value) { throw 'DSH temp has another owner' }
$rules = @($actual.GetAccessRules($true,$false,[Security.Principal.SecurityIdentifier]))
$full = @($rules | Where-Object {
    $_.IdentityReference.Value -eq $caller.Value -and
    $_.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
    ($_.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq [Security.AccessControl.FileSystemRights]::FullControl -and
    $_.InheritanceFlags -eq $inheritance -and $_.PropagationFlags -eq [Security.AccessControl.PropagationFlags]::None
})
if (-not $actual.AreAccessRulesProtected -or $full.Count -ne 1 -or @($rules | Where-Object {
    $_.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
    $_.IdentityReference.Value -notin @($caller.Value,'S-1-5-18')
}).Count) { throw 'DSH temp permissions differ from the managed private-directory permissions; refusing to replace them' }
@{path=$directory;owner=$caller.Value;protected=$actual.AreAccessRulesProtected;inheritableFullControl=$true} | ConvertTo-Json -Compress
