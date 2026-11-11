Pod::Spec.new do |s|
  s.name = 'CompanionWebView'
  s.version = '0.1.0'
  s.summary = 'Document-bound fixture WebView for GitHub Ultimate'
  s.description = s.summary
  s.license = { :type => 'MIT' }
  s.author = 'GitHub Ultimate contributors'
  s.homepage = 'https://github.com/mickmister/github-ultimate'
  s.platforms = { :ios => '15.1' }
  s.source = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'WebKit'
  s.source_files = '**/*.{h,m,mm,swift}'
  s.swift_version = '5.9'
end
