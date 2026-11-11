using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace cAlgo.Robots
{
    public partial class TVBridgeCBot
    {
        private const long NativeLogMaximumBytes = 10 * 1024 * 1024;
        private const int NativeLogRetainedBytes = 2 * 1024 * 1024;
        private static readonly object LogMaintenanceGate = new object();
        private static DateTime _nextLogMaintenanceUtc;
        private static int _logMaintenanceRunning;

        private void ScheduleLogMaintenance()
        {
            // Wall-clock scheduling: a fast backtest must not scan the disk every simulated minute.
            lock (LogMaintenanceGate)
            {
                if (DateTime.UtcNow < _nextLogMaintenanceUtc || _logMaintenanceRunning != 0)
                    return;
                _nextLogMaintenanceUtc = DateTime.UtcNow.AddSeconds(30);
                _logMaintenanceRunning = 1;
            }
            var assemblyName = GetType().Assembly.GetName().Name;
            Task.Run(() =>
            {
                try
                {
                    var trimmed = 0;
                    foreach (var path in GetManagedNativeLogPaths(assemblyName))
                        if (CTraderLogRetention.TrimToRecentLines(path,
                                NativeLogMaximumBytes, NativeLogRetainedBytes) == LogTrimResult.Trimmed)
                            trimmed++;
                    if (trimmed > 0)
                    {
                        try { BeginInvokeOnMainThread(() => Print(
                            "[LogTrim] Trimmed {0} log file(s); retaining the latest 2 MiB after 10 MiB.", trimmed)); }
                        catch { }
                    }
                }
                catch { /* Logging maintenance must never stop trading or a backtest. */ }
                finally
                {
                    lock (LogMaintenanceGate) _logMaintenanceRunning = 0;
                }
            });
        }

        private static IEnumerable<string> GetManagedNativeLogPaths(string assemblyName)
        {
            if (string.IsNullOrWhiteSpace(assemblyName) ||
                assemblyName.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
                yield break;
            var roots = new[] {
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments)
            }.Where(root => !string.IsNullOrWhiteSpace(root)).Distinct(StringComparer.Ordinal);
            foreach (var root in roots)
            {
                var folder = Path.Combine(root, "cAlgo", "Data", "cBots", assemblyName);
                if (!Directory.Exists(folder)) continue;
                // Only this cBot's native text logs; never events, settings, trades or market data.
                foreach (var path in Directory.EnumerateFiles(folder, "log.txt", new EnumerationOptions
                {
                    RecurseSubdirectories = true,
                    IgnoreInaccessible = true,
                    AttributesToSkip = FileAttributes.ReparsePoint
                }))
                    yield return path;
            }
            if (File.Exists(DebugLogPath)) yield return DebugLogPath;
        }
    }

    internal enum LogTrimResult { Unchanged, Trimmed, Busy, Failed }

    internal static class CTraderLogRetention
    {
        private static readonly byte[] Notice = Encoding.UTF8.GetBytes(
            "Info | [LogTrim] Older lines trimmed automatically; recent log follows.\n");

        internal static LogTrimResult TrimToRecentLines(string path, long maximumBytes, int retainedBytes)
        {
            if (maximumBytes <= 0 || retainedBytes <= Notice.Length || retainedBytes >= maximumBytes)
                throw new ArgumentOutOfRangeException(nameof(retainedBytes));
            try
            {
                if (!File.Exists(path) || new FileInfo(path).Length <= maximumBytes)
                    return LogTrimResult.Unchanged;
                // The native writer owns this file. Refuse to rewrite while another handle is
                // open; retry on a later pass instead of replacing its inode or racing its cursor.
                using var stream = new FileStream(path, FileMode.Open, FileAccess.ReadWrite, FileShare.None);
                if (stream.Length <= maximumBytes) return LogTrimResult.Unchanged;
                var count = (int)Math.Min(retainedBytes - Notice.Length, stream.Length);
                var bytes = new byte[count];
                stream.Seek(-count, SeekOrigin.End);
                var read = 0;
                while (read < count)
                {
                    var n = stream.Read(bytes, read, count - read);
                    if (n == 0) break;
                    read += n;
                }
                // Drop partial lines at either boundary, preserving complete UTF-8 lines.
                var newline = Array.IndexOf(bytes, (byte)'\n', 0, read);
                var start = newline < 0 ? read : newline + 1;
                var end = read == 0 ? 0 : Array.LastIndexOf(bytes, (byte)'\n', read - 1) + 1;
                if (end < start) end = start;
                stream.Position = 0;
                stream.Write(Notice, 0, Notice.Length);
                stream.Write(bytes, start, end - start);
                stream.SetLength(stream.Position);
                stream.Flush(true);
                return LogTrimResult.Trimmed;
            }
            catch (FileNotFoundException) { return LogTrimResult.Unchanged; }
            catch (DirectoryNotFoundException) { return LogTrimResult.Unchanged; }
            catch (IOException) { return LogTrimResult.Busy; }
            catch (UnauthorizedAccessException) { return LogTrimResult.Failed; }
        }
    }
}
