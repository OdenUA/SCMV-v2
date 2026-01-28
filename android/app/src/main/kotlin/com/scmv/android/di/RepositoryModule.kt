package com.scmv.android.di

import com.scmv.android.data.repository.AuthRepository
import com.scmv.android.data.repository.AuthRepositoryImpl
import com.scmv.android.data.repository.DeviceRepository
import com.scmv.android.data.repository.DeviceRepositoryImpl
import com.scmv.android.data.repository.TrackRepository
import com.scmv.android.data.repository.TrackRepositoryImpl
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Hilt module for repository bindings.
 * Binds repository interfaces to their implementations.
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class RepositoryModule {
    
    @Binds
    @Singleton
    abstract fun bindAuthRepository(impl: AuthRepositoryImpl): AuthRepository

    @Binds
    @Singleton
    abstract fun bindDeviceRepository(impl: DeviceRepositoryImpl): DeviceRepository

    @Binds
    @Singleton
    abstract fun bindTrackRepository(impl: TrackRepositoryImpl): TrackRepository
}
