using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Threading;
using System.Windows.Forms;

namespace SignatureOnwebLauncher
{
    internal static class Program
    {
        private const string Url = "http://localhost:3000/";

        [STAThread]
        private static void Main()
        {
            string appDir = AppDomain.CurrentDomain.BaseDirectory;
            string serverPath = Path.Combine(appDir, "server.js");

            if (!File.Exists(serverPath))
            {
                MessageBox.Show("找不到 server.js，請確認 exe 與專案檔案放在同一個資料夾。", "Signature-onweb");
                return;
            }

            if (!File.Exists(Path.Combine(appDir, ".env")))
            {
                MessageBox.Show("尚未找到 .env。將使用本機暫存模式啟動；若要寫入 Google Drive，請先設定 .env。", "Signature-onweb");
            }

            Process serverProcess = StartServer(appDir);
            if (serverProcess == null)
            {
                MessageBox.Show("無法啟動 Node.js。請先安裝 Node.js 20 或更新版本。", "Signature-onweb");
                return;
            }

            WaitForServer();
            Process.Start(new ProcessStartInfo(Url) { UseShellExecute = true });

            MessageBox.Show("Signature-onweb 已啟動。\n\n關閉這個視窗後，本機服務也會停止。", "Signature-onweb");

            try
            {
                if (!serverProcess.HasExited)
                {
                    serverProcess.Kill();
                }
            }
            catch
            {
                // Ignore shutdown errors.
            }
        }

        private static Process StartServer(string appDir)
        {
            try
            {
                var startInfo = new ProcessStartInfo
                {
                    FileName = "node",
                    Arguments = "server.js",
                    WorkingDirectory = appDir,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true
                };

                return Process.Start(startInfo);
            }
            catch
            {
                return null;
            }
        }

        private static void WaitForServer()
        {
            for (int i = 0; i < 25; i++)
            {
                try
                {
                    var request = WebRequest.Create(Url);
                    request.Timeout = 500;
                    using (request.GetResponse())
                    {
                        return;
                    }
                }
                catch
                {
                    Thread.Sleep(400);
                }
            }
        }
    }
}
