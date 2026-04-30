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
                MessageBox.Show("Cannot find server.js. Please keep the exe in the Signature-onweb package folder.", "Signature-onweb");
                return;
            }

            Process serverProcess = StartServer(appDir);
            if (serverProcess == null)
            {
                MessageBox.Show("Cannot start Node.js. Please install Node.js 20 or newer.", "Signature-onweb");
                return;
            }

            WaitForServer();
            Process.Start(new ProcessStartInfo(Url) { UseShellExecute = true });

            MessageBox.Show("Signature-onweb is running locally.\n\nClose this message after you finish using the app.", "Signature-onweb");

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
