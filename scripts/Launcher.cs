using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

// The launcher owns one process family. Closing the Job Object kills descendants
// if the owner exits or crashes; a duplicate launch owns only its secondary process.
internal static class Launcher
{
    const uint CREATE_SUSPENDED = 0x00000004;
    const uint CREATE_NO_WINDOW = 0x08000000;
    const uint KILL_ON_JOB_CLOSE = 0x00002000;
    const uint INFINITE = 0xffffffff;
    [StructLayout(LayoutKind.Sequential)]
    struct SECURITY_ATTRIBUTES { public uint length; public IntPtr descriptor; [MarshalAs(UnmanagedType.Bool)] public bool inherit; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct STARTUPINFO
    {
        public uint cb;
        public string lpReserved, lpDesktop, lpTitle;
        public uint dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public ushort wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public uint dwProcessId, dwThreadId; }
    [StructLayout(LayoutKind.Sequential)]
    struct BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct IO_COUNTERS { public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount; }
    [StructLayout(LayoutKind.Sequential)]
    struct EXTENDED_LIMIT_INFORMATION
    {
        public BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref EXTENDED_LIMIT_INFORMATION information, uint size);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern bool CreateProcess(string applicationName, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string directory, ref STARTUPINFO startup, out PROCESS_INFORMATION process);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool TerminateProcess(IntPtr process, uint exitCode);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern IntPtr CreateFile(string name, uint access, uint share, ref SECURITY_ATTRIBUTES security, uint creation, uint attributes, IntPtr template);

    static string Quote(string value)
    {
        var text = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in value)
        {
            if (c == '\\') { slashes++; continue; }
            if (c == '"') { text.Append('\\', slashes * 2 + 1); text.Append(c); slashes = 0; continue; }
            text.Append('\\', slashes); slashes = 0; text.Append(c);
        }
        text.Append('\\', slashes * 2); text.Append('"');
        return text.ToString();
    }

    [STAThread]
    static int Main(string[] args)
    {
        IntPtr job = IntPtr.Zero;
        PROCESS_INFORMATION process = new PROCESS_INFORMATION();
        bool resumed = false;
        IntPtr diagnosticLog = IntPtr.Zero, nullInput = IntPtr.Zero;
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string lab = Path.Combine(root, "lab");
        string logDir = Path.Combine(lab, "logs");
        try
        {
            bool debug = false;
            foreach (string arg in args) { if (arg == "--debug") debug = true; else throw new ArgumentException("Only --debug is supported."); }
            string executable = Path.Combine(lab, "client", "lceda-pro.exe");
            string profile = Path.Combine(lab, "profile");
            if (!File.Exists(Path.Combine(lab, "setup", "complete.json"))) throw new InvalidOperationException("Run setup.ps1 successfully before starting this client.");
            if (!File.Exists(executable)) throw new FileNotFoundException("The isolated EDA client has not been prepared.", executable);
            Directory.CreateDirectory(logDir);
            var limits = new EXTENDED_LIMIT_INFORMATION();
            limits.BasicLimitInformation.LimitFlags = KILL_ON_JOB_CLOSE;
            job = CreateJobObject(IntPtr.Zero, null);
            if (job == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateJobObject failed");
            if (!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(EXTENDED_LIMIT_INFORMATION)))) throw new Win32Exception(Marshal.GetLastWin32Error(), "Job limits failed");
            string arguments = Quote(executable) + " " + Quote("--userData=" + profile);
            if (debug) arguments += " --remote-debugging-address=127.0.0.1 --remote-debugging-port=9431";
            var startup = new STARTUPINFO();
            startup.cb = (uint)Marshal.SizeOf(typeof(STARTUPINFO));
            if (debug)
            {
                var security = new SECURITY_ATTRIBUTES { length = (uint)Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)), inherit = true };
                diagnosticLog = CreateFile(Path.Combine(logDir, "native-debug.log"), 4, 3, ref security, 4, 128, IntPtr.Zero);
                nullInput = CreateFile("NUL", 0x80000000, 3, ref security, 3, 128, IntPtr.Zero);
                if (diagnosticLog == new IntPtr(-1) || nullInput == new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error(), "Debug log setup failed");
                startup.dwFlags |= 0x100;
                startup.hStdInput = nullInput; startup.hStdOutput = diagnosticLog; startup.hStdError = diagnosticLog;
            }
            if (!CreateProcess(executable, new StringBuilder(arguments), IntPtr.Zero, IntPtr.Zero, debug, CREATE_SUSPENDED | CREATE_NO_WINDOW, IntPtr.Zero, lab, ref startup, out process)) throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateProcess failed");
            if (!AssignProcessToJobObject(job, process.hProcess)) throw new Win32Exception(Marshal.GetLastWin32Error(), "Process job assignment failed");
            if (ResumeThread(process.hThread) == 0xffffffff) throw new Win32Exception(Marshal.GetLastWin32Error(), "ResumeThread failed");
            resumed = true;
            File.AppendAllText(Path.Combine(logDir, "launcher.log"), DateTime.UtcNow.ToString("o") + " started owner-candidate=" + process.dwProcessId + " debug=" + debug + Environment.NewLine);
            if (WaitForSingleObject(process.hProcess, INFINITE) == 0xffffffff) throw new Win32Exception(Marshal.GetLastWin32Error(), "Wait failed");
            uint exitCode;
            if (!GetExitCodeProcess(process.hProcess, out exitCode)) throw new Win32Exception(Marshal.GetLastWin32Error(), "Exit status failed");
            File.AppendAllText(Path.Combine(logDir, "launcher.log"), DateTime.UtcNow.ToString("o") + " exited owner-candidate=" + process.dwProcessId + " code=" + exitCode + Environment.NewLine);
            return (int)exitCode;
        }
        catch (Exception error)
        {
            if (!resumed && process.hProcess != IntPtr.Zero) TerminateProcess(process.hProcess, 1);
            try { Directory.CreateDirectory(logDir); File.AppendAllText(Path.Combine(logDir, "launcher-errors.log"), DateTime.UtcNow.ToString("o") + " " + error + Environment.NewLine); } catch { /* GUI still reports launch failure. */ }
            MessageBox.Show(error.Message, "JLCEDA + DSH", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        finally
        {
            if (job != IntPtr.Zero) CloseHandle(job);
            if (diagnosticLog != IntPtr.Zero && diagnosticLog != new IntPtr(-1)) CloseHandle(diagnosticLog);
            if (nullInput != IntPtr.Zero && nullInput != new IntPtr(-1)) CloseHandle(nullInput);
            if (process.hThread != IntPtr.Zero) CloseHandle(process.hThread);
            if (process.hProcess != IntPtr.Zero) CloseHandle(process.hProcess);
        }
    }
}
