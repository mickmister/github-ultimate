"""Serve staged Storybook at / and its shared hosted assets at /app/assets/."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from os import environ


class StorybookHandler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        if path.startswith('/app/assets/'):
            self.directory = 'hosted-dist'
            try:
                return super().translate_path(path)
            finally:
                self.directory = 'hosted-dist/storybook'
        return super().translate_path(path)


handler = partial(StorybookHandler, directory='hosted-dist/storybook')
ThreadingHTTPServer(('127.0.0.1', int(environ.get('WEBAPP_STORYBOOK_PORT', '6011'))), handler).serve_forever()
