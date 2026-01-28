package com.scmv.android.ui.screen.map;

import com.scmv.android.data.repository.DeviceRepository;
import com.scmv.android.data.repository.TrackRepository;
import com.scmv.android.data.settings.AppSettings;
import dagger.internal.DaggerGenerated;
import dagger.internal.Factory;
import dagger.internal.QualifierMetadata;
import dagger.internal.ScopeMetadata;
import javax.annotation.processing.Generated;
import javax.inject.Provider;

@ScopeMetadata
@QualifierMetadata
@DaggerGenerated
@Generated(
    value = "dagger.internal.codegen.ComponentProcessor",
    comments = "https://dagger.dev"
)
@SuppressWarnings({
    "unchecked",
    "rawtypes",
    "KotlinInternal",
    "KotlinInternalInJava"
})
public final class MapViewModel_Factory implements Factory<MapViewModel> {
  private final Provider<TrackRepository> trackRepositoryProvider;

  private final Provider<DeviceRepository> deviceRepositoryProvider;

  private final Provider<AppSettings> appSettingsProvider;

  public MapViewModel_Factory(Provider<TrackRepository> trackRepositoryProvider,
      Provider<DeviceRepository> deviceRepositoryProvider,
      Provider<AppSettings> appSettingsProvider) {
    this.trackRepositoryProvider = trackRepositoryProvider;
    this.deviceRepositoryProvider = deviceRepositoryProvider;
    this.appSettingsProvider = appSettingsProvider;
  }

  @Override
  public MapViewModel get() {
    return newInstance(trackRepositoryProvider.get(), deviceRepositoryProvider.get(), appSettingsProvider.get());
  }

  public static MapViewModel_Factory create(Provider<TrackRepository> trackRepositoryProvider,
      Provider<DeviceRepository> deviceRepositoryProvider,
      Provider<AppSettings> appSettingsProvider) {
    return new MapViewModel_Factory(trackRepositoryProvider, deviceRepositoryProvider, appSettingsProvider);
  }

  public static MapViewModel newInstance(TrackRepository trackRepository,
      DeviceRepository deviceRepository, AppSettings appSettings) {
    return new MapViewModel(trackRepository, deviceRepository, appSettings);
  }
}
